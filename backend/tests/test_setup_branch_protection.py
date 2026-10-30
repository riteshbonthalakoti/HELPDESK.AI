import json
import subprocess
from unittest.mock import MagicMock, patch

import pytest
import sys
import os

# Add scripts directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "scripts")))

import setup_branch_protection as sbp


class TestSetupBranchProtection:
    """Unit test suite for scripts/setup_branch_protection.py (#4102)."""

    def test_default_cli_args(self):
        args = sbp.parse_args([])
        assert args.branch == "gssoc"
        assert args.repo == "riteshbonthalakoti/HELPDESK.AI"
        assert args.enforce_admins is True
        assert args.required_reviews == 1
        assert args.dry_run is False

    def test_custom_cli_args(self):
        args = sbp.parse_args([
            "--branch", "main",
            "--repo", "test-org/test-repo",
            "--no-enforce-admins",
            "--required-reviews", "2",
            "--dry-run"
        ])
        assert args.branch == "main"
        assert args.repo == "test-org/test-repo"
        assert args.enforce_admins is False
        assert args.required_reviews == 2
        assert args.dry_run is True

    def test_build_protection_payload_defaults(self):
        payload = sbp.build_protection_payload()
        assert payload["enforce_admins"] is True
        assert payload["required_status_checks"]["strict"] is True
        assert payload["required_status_checks"]["contexts"] == []
        assert payload["required_pull_request_reviews"]["required_approving_review_count"] == 1
        assert payload["required_pull_request_reviews"]["dismiss_stale_reviews"] is True
        assert payload["required_pull_request_reviews"]["require_code_owner_reviews"] is True
        assert payload["restrictions"] is None

    def test_build_protection_payload_custom(self):
        payload = sbp.build_protection_payload(
            enforce_admins=False,
            required_approving_review_count=3,
            dismiss_stale_reviews=False,
            require_code_owner_reviews=False,
            strict_status_checks=False,
            contexts=["ci/test", "ci/lint"]
        )
        assert payload["enforce_admins"] is False
        assert payload["required_status_checks"]["strict"] is False
        assert payload["required_status_checks"]["contexts"] == ["ci/test", "ci/lint"]
        assert payload["required_pull_request_reviews"]["required_approving_review_count"] == 3
        assert payload["required_pull_request_reviews"]["dismiss_stale_reviews"] is False
        assert payload["required_pull_request_reviews"]["require_code_owner_reviews"] is False

    def test_sanitization_valid_inputs(self):
        assert sbp.sanitize_repo("riteshbonthalakoti/HELPDESK.AI") == "riteshbonthalakoti/HELPDESK.AI"
        assert sbp.sanitize_branch("gssoc") == "gssoc"
        assert sbp.sanitize_branch("feature/branch-1.0") == "feature/branch-1.0"

    def test_sanitization_rejects_argument_injection(self):
        with pytest.raises(ValueError, match="Security validation failed"):
            sbp.sanitize_repo("--help")

        with pytest.raises(ValueError, match="Security validation failed"):
            sbp.sanitize_repo("invalid-repo-without-slash")

        with pytest.raises(ValueError, match="Security validation failed"):
            sbp.sanitize_branch("-XDELETE")

        with pytest.raises(ValueError, match="Security validation failed"):
            sbp.sanitize_branch("branch/with/../traversal")

    def test_setup_branch_protection_rejects_malicious_inputs(self):
        ret = sbp.setup_branch_protection(repo="--injected-arg", branch="main")
        assert ret == 2

    def test_dry_run_does_not_call_subprocess(self):
        with patch("subprocess.run") as mock_run:
            ret = sbp.setup_branch_protection(
                repo="custom/repo",
                branch="gssoc",
                dry_run=True
            )
            assert ret == 0
            mock_run.assert_not_called()

    def test_setup_branch_protection_success(self):
        mock_proc = MagicMock()
        mock_proc.returncode = 0
        mock_proc.stdout = '{"message": "Branch protection rules set"}'
        mock_proc.stderr = ""

        with patch("subprocess.run", return_value=mock_proc) as mock_run:
            ret = sbp.setup_branch_protection(
                repo="myorg/myrepo",
                branch="gssoc",
                enforce_admins=True,
                required_reviews=1,
                dry_run=False
            )
            assert ret == 0
            mock_run.assert_called_once()
            called_args, called_kwargs = mock_run.call_args
            assert called_args[0][:5] == ["gh", "api", "-X", "PUT", "/repos/myorg/myrepo/branches/gssoc/protection"]
            sent_payload = json.loads(called_kwargs["input"])
            assert sent_payload["enforce_admins"] is True
            assert sent_payload["required_pull_request_reviews"]["required_approving_review_count"] == 1

    def test_setup_branch_protection_gh_failure(self):
        mock_proc = MagicMock()
        mock_proc.returncode = 1
        mock_proc.stdout = ""
        mock_proc.stderr = "HTTP 404: Not Found"

        with patch("subprocess.run", return_value=mock_proc) as mock_run:
            ret = sbp.setup_branch_protection(
                repo="myorg/missing",
                branch="dev",
                dry_run=False
            )
            assert ret == 1
            mock_run.assert_called_once()

    def test_setup_branch_protection_missing_gh_cli(self):
        with patch("subprocess.run", side_effect=FileNotFoundError):
            ret = sbp.setup_branch_protection(dry_run=False)
            assert ret == 1

    def test_main_cli_execution(self):
        with patch("setup_branch_protection.setup_branch_protection", return_value=0) as mock_setup:
            exit_code = sbp.main(["--branch", "custom", "--no-enforce-admins", "--dry-run"])
            assert exit_code == 0
            mock_setup.assert_called_once_with(
                repo="riteshbonthalakoti/HELPDESK.AI",
                branch="custom",
                enforce_admins=False,
                required_reviews=1,
                dry_run=True
            )
