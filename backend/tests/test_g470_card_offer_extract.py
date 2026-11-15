"""G470: card rates and offers read from a statement PDF or a screenshot.

Synthetic data only: invented issuer, digits and amounts. Fixtures are built in
the test and the model is faked; no paid call is ever made.
"""
import asyncio
import io
import json
import os
import tempfile
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

import app.routers.analytics as analytics
import app.routers.card_terms as card_terms
import app.services.card_offer_extract as extract
from app.core import demo, timeutil
from tests.penny_proposal_fakes import FakeCollection

UID = "g470@example.test"
USER = {"email": UID}
NOW = date(2026, 11, 15)


def _end(days):
    return (timeutil.user_today() + timedelta(days=days)).isoformat()


# ---- synthetic fixtures ---------------------------------------------------------

def _pdf(lines, pages=1):
    from fpdf import FPDF
    pdf = FPDF()
    for _ in range(pages):
        pdf.add_page()
        pdf.set_font("Helvetica", size=11)
        for line in lines:
            pdf.cell(0, 8, line, new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


STATEMENT_LINES = [
    "Zenith Bank Platinum Card 4111 1111 1111 7788",
    "Statement date 01/11/2026",
    "Purchases 23.9% APR   Money advances 29.9%",
    "Promotional offers",
    "Balance transfer 0.0% GBP 1,234.50 until 01/08/2030",
]


def _png():
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(buf, "PNG")
    return buf.getvalue()


def _model_reply(**over):
    reply = {
        "issuer": "Zenith Bank", "last4": "7788", "statement_date": "2026-11-01",
        "purchase_apr_pct": 23.9, "cash_apr_pct": 29.9,
        "offers": [
            {"offer_type": "balance_transfer", "apr_pct": 0, "balance": 1234.5, "ends": "2030-08-01", "revert_apr_pct": 23.9},
            {"offer_type": "purchase", "apr_pct": 0, "balance": None, "ends": "2030-02-01", "revert_apr_pct": None},
        ],
    }
    reply.update(over)
    return reply


class _Resp:
    status_code = 200

    def __init__(self, obj):
        self._obj = obj

    def json(self):
        return {"choices": [{"message": {"content": json.dumps(self._obj)}}]}


@pytest.fixture
def fake_model(monkeypatch):
    calls = []

    def install(reply):
        async def fake(body, **kw):
            calls.append((body, kw))
            return _Resp(reply)
        monkeypatch.setattr(extract, "openrouter_chat", fake)
        return calls
    return install


def _cards():
    base = {"user_id": UID, "type": "credit_card", "subtype": "CREDIT_CARD", "currency": "GBP"}
    return [
        {**base, "_id": "c1", "provider": "zenith", "name": "Zenith Platinum", "account_number": "7788"},
        {**base, "_id": "c2", "provider": "orchid", "name": "Orchid Everyday", "account_number": "5521"},
        {**base, "_id": "c3", "provider": "orchid", "name": "Orchid Travel", "account_number": "5521"},
    ]


# ---- extraction parsing ---------------------------------------------------------

def test_pdf_extraction_parses_the_fake_model_reply(fake_model):
    calls = fake_model(_model_reply())
    out = asyncio.run(extract.extract_proposal(UID, _pdf(STATEMENT_LINES), "", _cards()))
    p = out["proposal"]
    assert out["source"] == {"kind": "pdf"}
    assert (p["issuer"], p["last4"], p["statement_date"]) == ("Zenith Bank", "7788", "2026-11-01")
    assert (p["purchase_apr_pct"], p["cash_apr_pct"]) == (23.9, 29.9)
    assert p["offers"][0] == {"offer_type": "balance_transfer", "apr_pct": 0.0, "balance": 1234.5,
                              "ends": "2030-08-01", "revert_apr_pct": 23.9, "match": None}
    assert out["match"]["status"] == "matched" and out["match"]["account_id"] == "c1"
    body, kw = calls[0]
    assert body["model"] == "google/gemini-2.5-flash" and kw["pipeline"] == "card_offer_extract"
    assert "untrusted" in body["messages"][0]["content"].lower()


def test_image_extraction_sends_a_data_uri_and_never_a_file(fake_model):
    calls = fake_model(_model_reply())
    out = asyncio.run(extract.extract_proposal(UID, _png(), "", _cards()))
    assert out["source"] == {"kind": "image"}
    part = calls[0][0]["messages"][1]["content"][1]
    assert part["image_url"]["url"].startswith("data:image/png;base64,")


def test_bad_model_values_are_dropped_with_a_warning(fake_model):
    fake_model(_model_reply(purchase_apr_pct=250, statement_date="2099-01-01", offers=[
        {"offer_type": "mystery", "apr_pct": 0, "ends": "2030-01-01"},
        {"offer_type": "cash", "apr_pct": 0, "balance": -5, "ends": "not a date"},
    ]))
    p = asyncio.run(extract.extract_proposal(UID, _pdf(STATEMENT_LINES), "", _cards()))["proposal"]
    assert p["purchase_apr_pct"] is None and p["statement_date"] is None
    assert [o["offer_type"] for o in p["offers"]] == ["cash"]
    assert p["offers"][0]["balance"] is None and p["offers"][0]["ends"] is None
    assert p["warnings"]


def test_garbage_reply_is_a_422(monkeypatch):
    async def fake(body, **kw):
        class R:
            status_code = 200
            def json(self):
                return {"choices": [{"message": {"content": "sorry"}}]}
        return R()
    monkeypatch.setattr(extract, "openrouter_chat", fake)
    with pytest.raises(HTTPException) as e:
        asyncio.run(extract.extract_proposal(UID, _png(), "", _cards()))
    assert e.value.status_code == 422


# ---- upload limits and kinds ----------------------------------------------------

def test_kinds_and_limits():
    assert extract.detect_kind(_png()) == "png"
    assert extract.detect_kind(b"\xff\xd8\xff\xe0abc") == "jpeg"
    with pytest.raises(HTTPException) as e:
        extract.detect_kind(b"\x00\x00\x00\x18ftypheic" + b"0" * 20)
    assert e.value.status_code == 415
    with pytest.raises(HTTPException) as e:
        extract.detect_kind(b"hello world, not a document")
    assert e.value.status_code == 415
    with pytest.raises(HTTPException) as e:
        asyncio.run(extract.pdf_text(_pdf(STATEMENT_LINES, pages=extract.MAX_PAGES + 2)))
    assert e.value.status_code == 413


# ---- card matching --------------------------------------------------------------

def test_match_unique_ambiguous_and_none():
    cards = _cards()
    unique = extract.match_card("Zenith", "7788", cards)
    assert unique["status"] == "matched" and unique["account_id"] == "c1"
    amb = extract.match_card("Orchid", "5521", cards)
    assert amb["status"] == "ambiguous" and amb["account_id"] is None
    assert {c["account_id"] for c in amb["candidates"]} == {"c2", "c3"}
    no_digits = extract.match_card("Orchid", None, cards)
    assert no_digits["status"] == "ambiguous" and no_digits["account_id"] is None
    none = extract.match_card("Other Bank", "0001", cards)
    assert none["status"] == "not_found" and none["account_id"] is None and len(none["candidates"]) == 3
    clash = extract.match_card("Orchid", "7788", cards)  # digits pick c1 but the issuer disagrees
    assert clash["status"] == "ambiguous" and clash["account_id"] is None


# ---- masking and no retained file -----------------------------------------------

def test_card_numbers_are_masked_before_the_model_and_in_the_proposal(fake_model):
    calls = fake_model(_model_reply(last4="4111 1111 1111 7788"))
    out = asyncio.run(extract.extract_proposal(UID, _pdf(STATEMENT_LINES), "", _cards()))
    sent = calls[0][0]["messages"][1]["content"]
    assert "4111 1111 1111" not in sent and "7788" in sent
    assert out["proposal"]["last4"] == "7788"
    assert "4111" not in json.dumps(out)


def test_no_file_is_written_anywhere(fake_model, monkeypatch):
    fake_model(_model_reply())
    tmp = tempfile.gettempdir()
    before = set(os.listdir(tmp))
    opened = []
    real_open = open

    def watching_open(path, mode="r", *a, **k):
        if any(c in mode for c in "wax+") and not str(path).startswith("/dev/"):
            opened.append(str(path))
        return real_open(path, mode, *a, **k)

    monkeypatch.setattr("builtins.open", watching_open)
    asyncio.run(extract.extract_proposal(UID, _pdf(STATEMENT_LINES), "", _cards()))
    asyncio.run(extract.extract_proposal(UID, _png(), "", _cards()))
    assert set(os.listdir(tmp)) - before == set()
    assert opened == []


# ---- endpoints ------------------------------------------------------------------

class _Upload:
    def __init__(self, data):
        self._b = io.BytesIO(data)

    async def read(self, n=-1):
        return self._b.read(n)


@pytest.fixture
def stores(monkeypatch):
    accounts, terms = FakeCollection(_cards()), FakeCollection()
    uploads, usage = FakeCollection(), FakeCollection()
    refreshed = []

    async def refresh(uid):
        refreshed.append(uid)

    monkeypatch.setattr(card_terms, "accounts_col", accounts)
    monkeypatch.setattr(card_terms, "card_terms_col", terms)
    monkeypatch.setattr(analytics, "_refresh_after_override", refresh)
    import app.db.collections as cols
    monkeypatch.setattr(cols, "llm_usage_col", usage)
    monkeypatch.setattr(cols, "statement_uploads_col", uploads)
    return terms, uploads, usage, refreshed


def test_extract_endpoint_saves_nothing_and_leaves_the_upload_cap_alone(stores, fake_model):
    terms, uploads, _usage, refreshed = stores
    fake_model(_model_reply())
    out = asyncio.run(card_terms.extract_card_offers(_Upload(_pdf(STATEMENT_LINES)), "", USER))
    assert out["match"]["status"] == "matched"
    assert terms.docs == [] and uploads.docs == [] and refreshed == []


def test_extract_route_is_declared_before_the_account_id_route():
    from app.main import app
    paths = [r.path for r in app.routes if "POST" in (getattr(r, "methods", None) or ())]
    assert paths.index("/card-terms/extract") < paths.index("/card-terms/{account_id}")


def test_extract_is_refused_for_the_demo_user(stores, fake_model, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config, "DEMO_LOGIN_EMAIL", "demo@example.test")
    fake_model(_model_reply())
    assert demo.demo_blocked("demo@example.test", "POST", "/card-terms/extract")
    assert not demo.demo_blocked(UID, "POST", "/card-terms/extract")
    with pytest.raises(HTTPException) as e:
        asyncio.run(card_terms.extract_card_offers(_Upload(_png()), "", {"email": "demo@example.test"}))
    assert e.value.status_code == 403


def test_extract_endpoint_size_and_monthly_cap(stores, fake_model):
    _terms, _uploads, usage, _r = stores
    fake_model(_model_reply())
    with pytest.raises(HTTPException) as e:
        asyncio.run(card_terms.extract_card_offers(_Upload(b"x" * (extract.MAX_BYTES + 1)), "", USER))
    assert e.value.status_code == 413
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    usage.docs.extend({"user_id": UID, "pipeline": "card_offer_extract", "ts": now}
                      for _ in range(extract.MONTHLY_EXTRACT_CAP))
    with pytest.raises(HTTPException) as e:
        asyncio.run(card_terms.extract_card_offers(_Upload(_png()), "", USER))
    assert e.value.status_code == 429


def test_extract_is_metered_in_its_own_pipeline_not_the_statement_cap():
    import inspect
    src = inspect.getsource(extract)
    assert "record_statement_upload" not in src and "check_statement_upload_allowed" not in src


def _confirm(body, account="c1"):
    return asyncio.run(card_terms.confirm_card_offers(account, body, USER))


def _body(**over):
    base = dict(
        statement_date="2026-11-01", purchase_apr_pct=23.9, cash_apr_pct=29.9,
        offers=[card_terms.OfferConfirm(offer_type="balance_transfer", apr_pct=0, balance=1234.5,
                                        ends=_end(400), revert_apr_pct=23.9),
                card_terms.OfferConfirm(offer_type="money_transfer", apr_pct=0, balance=100, ends=_end(200))])
    base.update(over)
    return card_terms.OffersConfirmBody(**base)


def test_confirm_validates_and_writes(stores):
    terms, _u, _usage, refreshed = stores
    out = _confirm(_body())
    t = out["terms"]
    assert t["apr_pct"] == 23.9 and t["cash_apr_pct"] == 29.9 and t["rates_as_of"] == "2026-11-01"
    first = t["promos"][0]
    assert first["kind"] == "balance_transfer" and first["offer_type"] == "balance_transfer"
    assert first["balance"] == 1234.5 and first["revert_apr_pct"] == 23.9 and first["as_of"] == "2026-11-01"
    assert t["promos"][1]["offer_type"] == "money_transfer" and t["promos"][1]["kind"] == "balance_transfer"
    assert terms.docs[0]["status"] == "confirmed" and refreshed == [UID]


@pytest.mark.parametrize("over,field", [
    ({"purchase_apr_pct": 101}, "purchase"),
    ({"cash_apr_pct": -1}, "cash"),
    ({"statement_date": "2999-01-01"}, "future"),
    ({"statement_date": "31/02/2026"}, "format"),
])
def test_confirm_rejects_bad_top_level_fields(stores, over, field):
    with pytest.raises(HTTPException) as e:
        _confirm(_body(**over))
    assert e.value.status_code == 400
    assert stores[0].docs == []


@pytest.mark.parametrize("offer", [
    dict(offer_type="purchase", apr_pct=120, ends="@200"),
    dict(offer_type="purchase", apr_pct=0, balance=-1, ends="@200"),
    dict(offer_type="purchase", apr_pct=0, ends="2030-02-31"),
    dict(offer_type="purchase", apr_pct=0, ends="@200", revert_apr_pct=101),
])
def test_confirm_rejects_bad_offers(stores, offer):
    offer = {k: (_end(200) if v == "@200" else v) for k, v in offer.items()}
    with pytest.raises(HTTPException) as e:
        _confirm(_body(offers=[card_terms.OfferConfirm(**offer)]))
    assert e.value.status_code == 400
    assert stores[0].docs == []


def test_confirm_rejects_an_unknown_offer_type():
    with pytest.raises(Exception):
        card_terms.OfferConfirm(offer_type="gift", apr_pct=0, ends="2030-01-01")


def test_confirm_for_someone_elses_card_is_404(stores):
    with pytest.raises(HTTPException) as e:
        asyncio.run(card_terms.confirm_card_offers("c1", _body(), {"email": "other@example.test"}))
    assert e.value.status_code == 404


# ---- backward compatibility -----------------------------------------------------

def test_old_documents_still_read(stores):
    terms, *_ = stores
    old = {"_id": f"{UID}:c1", "user_id": UID, "account_id": "c1", "apr_pct": 19.9,
           "promos": [{"kind": "purchases", "apr_pct": 0.0, "until": "2030-01-01"}],
           "bt_offers": [{"ends": "2030-01-01", "fee_pct": 3.0, "note": None}], "status": "confirmed"}
    t = card_terms._serialize_terms(old)
    assert [{k: v for k, v in p.items() if k != "id"} for p in t["promos"]] == old["promos"]
    assert t["bt_offers"] == old["bt_offers"]
    assert t["promos"][0]["id"] == card_terms._serialize_terms(old)["promos"][0]["id"]  # stable across reads
    assert t["cash_apr_pct"] is None and t["rates_as_of"] is None
    legacy = card_terms._serialize_terms({"on_promo": True, "promo_kind": "purchases", "promo_end": "2030-01-01"})
    assert [{k: v for k, v in p.items() if k != "id"} for p in legacy["promos"]] == [
        {"kind": "purchases", "apr_pct": 0.0, "until": "2030-01-01"}]


def test_old_style_promo_normalises_to_the_same_shape_as_before():
    body = card_terms.CardTermsBody(promos=[card_terms.CardPromo(kind="purchases", apr_pct=0, until=_end(30))])
    out = card_terms._normalise_promos(body)
    assert [{k: v for k, v in p.items() if k != "id"} for p in out] == [{"kind": "purchases", "apr_pct": 0.0, "until": _end(30)}]
    assert out[0]["id"]
    with pytest.raises(HTTPException):
        card_terms._normalise_promos(card_terms.CardTermsBody(
            promos=[card_terms.CardPromo(kind="purchases", apr_pct=31, until=_end(30))]))


def test_a_later_whole_save_keeps_the_extended_offer_and_cash_rate(stores):
    terms, *_ = stores
    _confirm(_body())
    stored = terms.docs[0]
    body = card_terms.CardTermsBody(apr_pct=24.9, promos=[card_terms.CardPromo(**p) for p in stored["promos"]])
    out = asyncio.run(card_terms.save_card_terms("c1", body, USER))["terms"]
    assert out["cash_apr_pct"] == 29.9 and out["rates_as_of"] == "2026-11-01"
    assert out["promos"][0]["balance"] == 1234.5 and out["promos"][0]["revert_apr_pct"] == 23.9


def test_readers_ignore_the_extra_offer_fields(stores):
    from app.services import debt_plan
    terms, *_ = stores
    _confirm(_body())
    flags = {"assumptions": [], "promo_whole_balance_assumed": False}
    segs, std = debt_plan._compute_rate_schedule(timeutil.user_today(), terms.docs[0], flags)
    assert std == 23.9
    assert segs[0]["source"] == "promo" and segs[0]["kind"] == "balance_transfer" and segs[-1]["source"] == "standard"


# ---- merge, ids, ended offers, caps (review round) -------------------------------

def _seed(terms, promos):
    terms.docs.append({"_id": f"{UID}:c1", "user_id": UID, "account_id": "c1", "apr_pct": 20.0,
                       "promos": promos, "bt_offers": [], "status": "confirmed"})


def _p(kind, until, apr=0.0, **extra):
    return {"kind": kind, "apr_pct": apr, "until": until, **extra}


def _ids(terms):
    return [p["id"] for p in terms.docs[0]["promos"]]


def test_a_single_offer_confirm_keeps_the_other_existing_promos(stores):
    terms, *_ = stores
    _seed(terms, [_p("purchases", _end(100)), _p("balance_transfer", _end(300))])
    one = card_terms.OfferConfirm(offer_type="money_transfer", apr_pct=0, balance=50, ends=_end(500))
    out = _confirm(_body(offers=[one], purchase_apr_pct=None, cash_apr_pct=None, statement_date=None))
    assert len(out["terms"]["promos"]) == 3
    assert {p["until"] for p in terms.docs[0]["promos"]} >= {_end(100), _end(300), _end(500)}


def test_update_by_id_changes_only_that_promo(stores):
    terms, *_ = stores
    _seed(terms, [_p("purchases", _end(100)), _p("balance_transfer", _end(300))])
    target = card_terms._serialize_terms(terms.docs[0])["promos"][1]["id"]
    upd = card_terms.OfferConfirm(id=target, offer_type="balance_transfer", apr_pct=0, balance=999, ends=_end(310))
    _confirm(_body(offers=[upd]))
    promos = terms.docs[0]["promos"]
    assert len(promos) == 2 and promos[1]["id"] == target and promos[1]["balance"] == 999 and promos[1]["until"] == _end(310)
    assert promos[0]["until"] == _end(100)


def test_explicit_removal_only(stores):
    terms, *_ = stores
    _seed(terms, [_p("purchases", _end(100)), _p("balance_transfer", _end(300))])
    first, second = [p["id"] for p in card_terms._serialize_terms(terms.docs[0])["promos"]]
    _confirm(card_terms.OffersConfirmBody(remove_ids=[first]))
    assert _ids(terms) == [second]


def test_a_foreign_or_unknown_id_is_rejected(stores):
    terms, *_ = stores
    _seed(terms, [_p("purchases", _end(100))])
    bad = card_terms.OfferConfirm(id="pnotmine", offer_type="purchase", apr_pct=0, ends=_end(50))
    with pytest.raises(HTTPException) as e:
        _confirm(card_terms.OffersConfirmBody(offers=[bad]))
    assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e:
        _confirm(card_terms.OffersConfirmBody(remove_ids=["pnotmine"]))
    assert e.value.status_code == 400
    assert len(terms.docs[0]["promos"]) == 1


def test_exceeding_four_promos_is_a_400_not_a_truncation(stores):
    terms, *_ = stores
    _seed(terms, [_p("purchases", _end(100)), _p("balance_transfer", _end(200)), _p("balance_transfer", _end(300))])
    two = [card_terms.OfferConfirm(offer_type="cash", apr_pct=0, ends=_end(400)),
           card_terms.OfferConfirm(offer_type="money_transfer", apr_pct=0, ends=_end(500))]
    with pytest.raises(HTTPException) as e:
        _confirm(_body(offers=two))
    assert e.value.status_code == 400 and "4" in e.value.detail
    assert len(terms.docs[0]["promos"]) == 3


def test_ids_stay_stable_across_reads_and_a_whole_list_save(stores):
    terms, *_ = stores
    _seed(terms, [_p("purchases", _end(100)), _p("balance_transfer", _end(300), offer_type="balance_transfer", balance=10)])
    before = [p["id"] for p in card_terms._serialize_terms(terms.docs[0])["promos"]]
    assert before == [p["id"] for p in card_terms._serialize_terms(terms.docs[0])["promos"]]
    # Penny's path: the existing raw promos (no ids stored) go back through a whole save.
    body = card_terms.CardTermsBody(apr_pct=21.0, promos=[card_terms.CardPromo(**p) for p in terms.docs[0]["promos"]])
    asyncio.run(card_terms.save_card_terms("c1", body, USER))
    assert _ids(terms) == before
    asyncio.run(card_terms.save_card_terms("c1", card_terms.CardTermsBody(
        apr_pct=22.0, promos=[card_terms.CardPromo(**p) for p in terms.docs[0]["promos"]]), USER))
    assert _ids(terms) == before


def test_ended_offers_are_listed_apart_and_skipped_on_confirm(stores, fake_model):
    terms, *_ = stores
    fake_model(_model_reply(offers=[
        {"offer_type": "purchase", "apr_pct": 0, "ends": "2020-01-01"},
        {"offer_type": "balance_transfer", "apr_pct": 0, "balance": 5, "ends": "2030-08-01"}]))
    out = asyncio.run(extract.extract_proposal(UID, _png(), "", _cards()))
    assert [o["ends"] for o in out["proposal"]["ended"]] == ["2020-01-01"]
    assert [o["ends"] for o in out["proposal"]["offers"]] == ["2030-08-01"]
    old = card_terms.OfferConfirm(offer_type="purchase", apr_pct=0, ends="2020-01-01")
    res = _confirm(card_terms.OffersConfirmBody(offers=[old]))
    assert res["warnings"] and terms.docs[0].get("promos", []) == []


def test_more_than_eight_offers_warns(fake_model):
    rows = [{"offer_type": "purchase", "apr_pct": 0, "ends": f"20{30 + i}-01-01"} for i in range(10)]
    fake_model(_model_reply(offers=rows))
    p = asyncio.run(extract.extract_proposal(UID, _png(), "", _cards()))["proposal"]
    assert len(p["offers"]) == 8 and any("10 offers" in w for w in p["warnings"])


def test_suggested_matches_and_existing_in_the_extract_response(stores, fake_model):
    terms, *_ = stores
    _seed(terms, [_p("balance_transfer", "2030-08-03"), _p("purchases", "2030-02-01")])
    fake_model(_model_reply())
    out = asyncio.run(card_terms.extract_card_offers(_Upload(_png()), "", USER))
    existing = out["match"]["existing"]
    assert [e["ends"] for e in existing] == ["2030-08-03", "2030-02-01"]
    # BT ends 2030-08-01 is within 7 days of 2030-08-03; the purchase offer matches on type and date.
    assert [o["match"] for o in out["proposal"]["offers"]] == [existing[0]["id"], existing[1]["id"]]
    assert terms.docs[0]["promos"][0].get("id") is None  # reading never writes


def test_a_new_offer_has_no_suggested_match():
    promos = [{"id": "pa", "kind": "purchases", "until": "2030-01-01"}]
    far = {"offer_type": "balance_transfer", "ends": "2030-01-01"}
    assert extract.suggest_matches([far], promos) == [None]


def test_oversized_uploads_are_refused_before_parsing():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    app = FastAPI()
    hit = []

    from fastapi import UploadFile

    async def up(file: UploadFile):
        hit.append(1)
        return {"n": len(await file.read())}

    from fastapi import APIRouter
    r = APIRouter()
    r.add_api_route("/up", up, methods=["POST"], route_class_override=extract.CappedUploadRoute)
    app.include_router(r)

    c = TestClient(app)
    assert c.post("/up", files={"file": ("a.png", b"x" * 1000)}).status_code == 200
    r = c.post("/up", files={"file": ("a.png", b"x" * (extract.MAX_REQUEST_BYTES + 10))})
    assert r.status_code == 413 and len(hit) == 1
    # No Content-Length: a streamed body is still capped.
    def gen():
        yield b"x" * (extract.MAX_REQUEST_BYTES + 10)
    r = c.post("/up", content=gen(), headers={"content-type": "multipart/form-data; boundary=zz"})
    assert r.status_code == 413 and len(hit) == 1


def test_the_monthly_count_uses_the_london_month(stores):
    _t, _u, usage, _r = stores
    from datetime import datetime, timezone
    first = timeutil.user_today().replace(day=1)
    start = datetime.combine(first, datetime.min.time(), tzinfo=timeutil.LONDON).astimezone(timezone.utc)
    # Just before London midnight on the 1st does not count toward this month.
    usage.docs.extend({"user_id": UID, "pipeline": "card_offer_extract", "ts": start - timedelta(minutes=1)}
                      for _ in range(extract.MONTHLY_EXTRACT_CAP))
    asyncio.run(extract.check_extract_allowed(UID))
