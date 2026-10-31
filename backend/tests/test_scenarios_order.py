"""H143: the order-dependence guard.

No test may leave a fake collection bound as an app module's own handle. The
scenario harness rebinds every Motor handle to its own client, so a fake that
a lazy import captured while another test had db_collections patched survives
monkeypatch's restore and silently changes the scenario figures. Run late in
the default order, this also reports the leaking module by name; the explicit
ordered run lives in scripts/check_scenarios_order.py.
"""
from tests.test_scenarios import leaked_test_handles


def test_no_test_leaves_a_fake_collection_bound_in_an_app_module():
    assert leaked_test_handles() == []
