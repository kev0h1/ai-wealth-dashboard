"""Focused H165 tests. Every deployment, network and git boundary is mocked."""
from contextlib import nullcontext
import unittest
from unittest.mock import patch

from scripts import integrate


ROUTER_CHANGE = {"backend/app/routers/oauth.py", "backend/tests/test_oauth_server.py"}
REASON = "Audited worker imports: oauth router is not worker-consumed."


class WorkerRestartOverrideTests(unittest.TestCase):
    def test_default_backend_restart_still_restarts_api_and_worker(self):
        with patch.object(integrate, "_systemctl_restart") as restart:
            integrate._restart_services({"backend/app/routers/oauth.py"})
        self.assertEqual(restart.call_args_list[0].args, ("wealth-api",))
        self.assertEqual(restart.call_args_list[1].args, ("wealth-worker",))

    def test_approved_api_router_override_restarts_api_but_not_worker(self):
        reason = integrate._validate_worker_restart_skip(ROUTER_CHANGE, REASON)
        with patch.object(integrate, "_systemctl_restart") as restart:
            integrate._restart_services({"backend/app/routers/oauth.py"}, skip_worker_restart_reason=reason)
        self.assertEqual(restart.call_args_list[0].args, ("wealth-api",))
        self.assertEqual(len(restart.call_args_list), 1)

    def test_blank_reason_is_refused(self):
        with self.assertRaisesRegex(integrate.IntegrateError, "non-blank audited reason"):
            integrate._normalise_skip_worker_restart_reason(" \n\t ")

    def test_shared_backend_code_is_refused_before_deployment(self):
        with self.assertRaisesRegex(integrate.IntegrateError, "outside API routers or tests"):
            integrate._validate_worker_restart_skip(
                {"backend/app/routers/oauth.py", "backend/app/services/mcp_mask.py"},
                REASON,
            )

    def test_rollback_preserves_an_approved_skip_decision(self):
        changed = {"backend/app/routers/oauth.py"}
        integrate._FRONTEND_SWAPPED = False
        with (
            patch.object(integrate, "_board_lock", return_value=nullcontext()),
            patch.object(integrate, "_sh", return_value=(0, "")),
            patch.object(integrate, "_install_dependencies"),
            patch.object(integrate, "_wait_and_check_health"),
            patch.object(integrate, "_restart_services") as restart,
        ):
            integrate._rollback_and_restart("before", "merge", changed, REASON)
        restart.assert_called_once_with(changed, skip_worker_restart_reason=REASON)

    def test_default_rollback_keeps_the_legacy_restart_call(self):
        changed = {"backend/app/routers/oauth.py"}
        integrate._FRONTEND_SWAPPED = False
        with (
            patch.object(integrate, "_board_lock", return_value=nullcontext()),
            patch.object(integrate, "_sh", return_value=(0, "")),
            patch.object(integrate, "_install_dependencies"),
            patch.object(integrate, "_wait_and_check_health"),
            patch.object(integrate, "_restart_services") as restart,
        ):
            integrate._rollback_and_restart("before", "merge", changed)
        restart.assert_called_once_with(changed)

    def test_default_integrate_once_keeps_the_legacy_integrate_one_call(self):
        item = {"id": "F30", "branch": "feature-F30", "title": "Assistants"}
        with (
            patch.object(integrate, "_locked", return_value=nullcontext()),
            patch.object(integrate, "_check_preconditions"),
            patch.object(integrate, "_sh", return_value=(0, "")),
            patch.object(integrate, "_review_items", return_value=[item]),
            patch.object(integrate, "_rejected_items", return_value=[]),
            patch.object(integrate, "_cancelled_items", return_value=[]),
            patch.object(integrate, "_review_items_missing_branch", return_value=[]),
            patch.object(integrate, "_integrate_one", return_value=("skipped", "F30: skipped")) as one,
        ):
            self.assertEqual(integrate.integrate_once(), 0)
        one.assert_called_once_with(item)

    def test_cli_rejects_override_without_explicit_once(self):
        with self.assertRaises(SystemExit):
            integrate.main(["--only", "F30", "--skip-worker-restart", REASON])

    def test_cli_rejects_override_without_explicit_only(self):
        with self.assertRaises(SystemExit):
            integrate.main(["--once", "--skip-worker-restart", REASON])

    def test_cli_rejects_override_in_a_loop(self):
        with self.assertRaises(SystemExit):
            integrate.main(["--once", "--loop", "60", "--only", "F30", "--skip-worker-restart", REASON])

    def test_cli_rejects_blank_override_reason(self):
        with self.assertRaises(SystemExit):
            integrate.main(["--once", "--only", "F30", "--skip-worker-restart", "  "])

    def test_cli_forwards_an_explicit_override_reason(self):
        with patch.object(integrate, "integrate_once", return_value=0) as once:
            self.assertEqual(integrate.main(["--once", "--only", "F30", "--skip-worker-restart", REASON]), 0)
        once.assert_called_once_with(
            allow_branch=None,
            only=["F30"],
            skip_worker_restart_reason=REASON,
        )

    def test_scope_refusal_happens_before_window_or_merge(self):
        item = {"id": "F30", "branch": "feature-F30", "title": "Assistants"}
        with (
            patch.object(integrate, "_sh", return_value=(0, "base\n")),
            patch.object(
                integrate,
                "_changed_paths",
                return_value={"backend/app/routers/oauth.py", "backend/app/core/config.py"},
            ),
            patch.object(integrate, "_open_window") as open_window,
        ):
            with self.assertRaisesRegex(integrate.IntegrateError, "outside API routers or tests"):
                integrate._integrate_one(item, REASON)
        open_window.assert_not_called()


if __name__ == "__main__":
    unittest.main()
