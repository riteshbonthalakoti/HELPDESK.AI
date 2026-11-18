"""
Contributor Compliance & Triage Script for WSOC 2026 (Winter of Code Social) — riteshbonthalakoti/HELPDESK.AI
Audits whether PR / Issue authors:
1. Follow @riteshbonthalakoti
2. Starred riteshbonthalakoti/HELPDESK.AI
3. Forked riteshbonthalakoti/HELPDESK.AI
4. Target the 'main' branch (for PRs)
5. Register employee account under RITESH PVT LTD
"""

import sys
import json
import argparse
import subprocess
from pathlib import Path

REPO = "riteshbonthalakoti/HELPDESK.AI"
ADMIN = "riteshbonthalakoti"
TARGET_BRANCH = "main"
AUDIT_MARKER = "Contributor Onboarding & Compliance Audit (WSOC 2026)"
LEGACY_AUDIT_MARKERS = (
    AUDIT_MARKER,
    "Contributor Onboarding & Compliance Audit (GSSoC 2026)",
)


def run_gh(cmd, check=True):
    try:
        res = subprocess.run(["gh"] + cmd, capture_output=True, text=True, check=check, encoding="utf-8", errors="replace")
        return res.stdout.strip()
    except Exception as e:
        print(f"[ERROR] gh {' '.join(cmd)} failed: {e}", file=sys.stderr)
        return ""


def run_gh_json(cmd):
    output = run_gh(cmd, check=False)
    if not output:
        return []
    try:
        return json.loads(output)
    except Exception:
        return []


def get_paginated(endpoint):
    items = []
    page = 1
    while True:
        res = run_gh_json(["api", f"{endpoint}?per_page=100&page={page}"])
        if not res or not isinstance(res, list):
            break
        items.extend(res)
        if len(res) < 100:
            break
        page += 1
    return items


def load_network_sets():
    print(f"Fetching followers of @{ADMIN}...")
    followers_data = get_paginated(f"/users/{ADMIN}/followers")
    followers = {u["login"].lower() for u in followers_data if "login" in u}

    print(f"Fetching stargazers of {REPO}...")
    stargazers_data = get_paginated(f"/repos/{REPO}/stargazers")
    stargazers = {u["login"].lower() for u in stargazers_data if "login" in u}

    print(f"Fetching forks of {REPO}...")
    forks_data = get_paginated(f"/repos/{REPO}/forks")
    forkers = {f["owner"]["login"].lower() for f in forks_data if "owner" in f and "login" in f["owner"]}

    print(f"Loaded {len(followers)} followers, {len(stargazers)} stargazers, {len(forkers)} forks.")
    return followers, stargazers, forkers


def generate_comment_body(author, missing, is_pr=False, base=None):
    follow_checked = "x" if "Follow Project Admin" not in missing else " "
    star_checked = "x" if "Star Repository" not in missing else " "
    fork_checked = "x" if "Fork Repository" not in missing else " "
    branch_checked = "x" if not any(f"Target {TARGET_BRANCH}" in m for m in missing) else " "

    body = f"""### 📋 {AUDIT_MARKER}

Hello @{author}! Thank you for your contribution to **HELPDESK.AI**.

Before this {"pull request can be merged" if is_pr else "issue can be assigned/approved"} under **WSOC 2026**, please ensure all contributor onboarding requirements from our [Contributor Onboarding Guide](https://github.com/riteshbonthalakoti/HELPDESK.AI/blob/main/docs/WSOC_DEV_ONBOARDING.md) are complete:

- [{follow_checked}] **Follow Maintainer**: Follow [@{ADMIN}](https://github.com/{ADMIN}) on GitHub.
- [{star_checked}] **Star Repository**: Star [{REPO}](https://github.com/{REPO}).
- [{fork_checked}] **Fork Repository**: Fork the repository to your GitHub account.
"""
    if is_pr:
        body += f"- [{branch_checked}] **Target Branch**: Pull requests must target branch `{TARGET_BRANCH}` (currently targeting `{base}`).\n"
    else:
        body += f"- [ ] **Target Branch**: Ensure any future Pull Request targets the `{TARGET_BRANCH}` branch.\n"

    body += """- [ ] **Live Portal Signup**: Register your employee test account under company **RITESH PVT LTD** on the [HelpDesk AI Portal](https://helpdeskai1918.vercel.app/signup).

Once you have completed these steps, reply here so our maintainer team can proceed with review and approval! 🚀"""
    return body


def check_item_already_commented(item_type, item_number):
    comments_raw = run_gh([item_type, "view", str(item_number), "--repo", REPO, "--json", "comments"], check=False)
    if comments_raw:
        try:
            data = json.loads(comments_raw)
            for c in data.get("comments", []):
                body = c.get("body", "")
                if any(marker in body for marker in LEGACY_AUDIT_MARKERS):
                    return True
        except Exception:
            pass
    return False


def post_comment(item_type, item_number, body):
    print(f"Posting compliance reminder on {item_type} #{item_number}...")
    res = subprocess.run(["gh", item_type, "comment", str(item_number), "--repo", REPO, "--body", body],
                         capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.returncode == 0:
        print(f"Successfully posted comment on {item_type} #{item_number}")
    else:
        print(f"[ERROR] Failed to post comment on {item_type} #{item_number}: {res.stderr}")


def triage_pr(pr_number, followers, stargazers, forkers, apply_comment=False):
    pr_data = run_gh_json(["pr", "view", str(pr_number), "--repo", REPO,
                           "--json", "number,title,author,baseRefName,headRefName,url"])
    if not pr_data:
        print(f"PR #{pr_number} not found.")
        return None

    author = pr_data["author"]["login"]
    author_lower = author.lower()
    base = pr_data.get("baseRefName", "")

    if author_lower in (ADMIN.lower(), "github-actions", "dependabot", "app/dependabot"):
        print(f"Skipping maintainer/bot @{author} for PR #{pr_number}.")
        return {"type": "pr", "number": pr_number, "author": author, "base": base, "compliant": True, "missing": []}

    is_following = author_lower in followers
    has_starred = author_lower in stargazers
    has_forked = author_lower in forkers
    correct_branch = base == TARGET_BRANCH

    compliant = is_following and has_starred and has_forked and correct_branch
    missing = []
    if not is_following:
        missing.append("Follow Project Admin")
    if not has_starred:
        missing.append("Star Repository")
    if not has_forked:
        missing.append("Fork Repository")
    if not correct_branch:
        missing.append(f"Target {TARGET_BRANCH} branch (currently {base})")

    status_str = "[PASS]" if compliant else "[MISSING: " + ", ".join(missing) + "]"
    print(f"PR #{pr_number:<4} by @{author:<20} | {status_str}")

    if not compliant and apply_comment:
        if check_item_already_commented("pr", pr_number):
            print(f"PR #{pr_number} already has compliance reminder. Skipping.")
        else:
            body = generate_comment_body(author, missing, is_pr=True, base=base)
            post_comment("pr", pr_number, body)

    return {
        "type": "pr",
        "number": pr_number,
        "author": author,
        "base": base,
        "compliant": compliant,
        "missing": missing
    }


def triage_issue(issue_number, followers, stargazers, forkers, apply_comment=False):
    issue_data = run_gh_json(["issue", "view", str(issue_number), "--repo", REPO,
                              "--json", "number,title,author,url"])
    if not issue_data:
        print(f"Issue #{issue_number} not found.")
        return None

    author = issue_data["author"]["login"]
    author_lower = author.lower()

    if author_lower in (ADMIN.lower(), "github-actions", "dependabot", "app/dependabot"):
        print(f"Skipping maintainer/bot @{author} for Issue #{issue_number}.")
        return {"type": "issue", "number": issue_number, "author": author, "compliant": True, "missing": []}

    is_following = author_lower in followers
    has_starred = author_lower in stargazers
    has_forked = author_lower in forkers

    compliant = is_following and has_starred and has_forked
    missing = []
    if not is_following:
        missing.append("Follow Project Admin")
    if not has_starred:
        missing.append("Star Repository")
    if not has_forked:
        missing.append("Fork Repository")

    status_str = "[PASS]" if compliant else "[MISSING: " + ", ".join(missing) + "]"
    print(f"Issue #{issue_number:<4} by @{author:<20} | {status_str}")

    if not compliant and apply_comment:
        if check_item_already_commented("issue", issue_number):
            print(f"Issue #{issue_number} already has compliance reminder. Skipping.")
        else:
            body = generate_comment_body(author, missing, is_pr=False)
            post_comment("issue", issue_number, body)

    return {
        "type": "issue",
        "number": issue_number,
        "author": author,
        "compliant": compliant,
        "missing": missing
    }


def main():
    parser = argparse.ArgumentParser(description="Contributor Compliance Triage for WSOC 2026")
    parser.add_argument("--pr", type=int, help="Triage a specific Pull Request number")
    parser.add_argument("--issue", type=int, help="Triage a specific Issue number")
    parser.add_argument("--apply", "--comment", action="store_true", help="Post comment if non-compliant")
    args = parser.parse_args()

    followers, stargazers, forkers = load_network_sets()

    if args.pr:
        triage_pr(args.pr, followers, stargazers, forkers, apply_comment=args.apply)
        return

    if args.issue:
        triage_issue(args.issue, followers, stargazers, forkers, apply_comment=args.apply)
        return

    # Full audit
    print("\n=== Running Full Contributor Compliance Audit (WSOC 2026) ===")
    prs = run_gh_json(["pr", "list", "--repo", REPO, "--state", "open", "--limit", "100",
                       "--json", "number,title,author,baseRefName,headRefName,url"])
    results = []
    for pr in prs:
        author = pr["author"]["login"]
        if author.lower() in ("github-actions", "dependabot", "app/dependabot"):
            continue
        res = triage_pr(pr["number"], followers, stargazers, forkers, apply_comment=args.apply)
        if res:
            results.append(res)

    report_file = Path("contributor_compliance_report.json")
    with open(report_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"\nReport written to {report_file.resolve()}")


if __name__ == "__main__":
    main()
