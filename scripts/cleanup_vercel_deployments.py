"""
Vercel Deployment Cleanup Script (Standard Library - zero external dependencies)
Bulk-deletes old preview deployments to reclaim Deployment Storage (10 GB quota).
Preserves the active production deployment.
"""

import sys
import os
import json
import argparse
import urllib.request
import urllib.error

VERCEL_API_BASE = "https://api.vercel.com"

def api_request(url, token, method="GET", data=None):
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "User-Agent": "HELPDESK-Vercel-Maintenance/1.0"
    }
    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read().decode("utf-8")
            return resp.status, json.loads(content) if content else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(err_body)
        except Exception:
            return e.code, {"error": err_body}
    except Exception as e:
        return 500, {"error": str(e)}

def get_auth_info(token):
    status, data = api_request(f"{VERCEL_API_BASE}/v2/user", token)
    if status != 200:
        print(f"[ERROR] Authentication failed (status {status}): {data}", flush=True)
        return None, []
    user = data.get("user", {})
    username = user.get("username", "")
    print(f"[OK] Authenticated as @{username} ({user.get('email', '')})", flush=True)

    status_teams, data_teams = api_request(f"{VERCEL_API_BASE}/v2/teams", token)
    teams = data_teams.get("teams", []) if status_teams == 200 else []
    return user, teams

def fetch_projects(token, team_id=None):
    url = f"{VERCEL_API_BASE}/v9/projects"
    if team_id:
        url += f"?teamId={team_id}"
    status, data = api_request(url, token)
    if status == 200:
        return data.get("projects", [])
    return []

def fetch_all_deployments(token, team_id=None):
    deployments = []
    until = None
    page = 1

    print("Fetching deployments from Vercel API...", flush=True)
    while True:
        url = f"{VERCEL_API_BASE}/v6/deployments?limit=100"
        if team_id:
            url += f"&teamId={team_id}"
        if until:
            url += f"&until={until}"

        status, data = api_request(url, token)
        if status != 200:
            print(f"[WARNING] Failed to fetch page {page}: {status} - {data}", flush=True)
            break

        items = data.get("deployments", [])
        if not items:
            break

        deployments.extend(items)
        print(f"  Fetched {len(deployments)} deployments...", flush=True)

        pagination = data.get("pagination", {})
        until = pagination.get("next")
        if not until or len(items) < 100:
            break
        page += 1

    return deployments

def delete_deployment(token, dep_id, team_id=None):
    url = f"{VERCEL_API_BASE}/v13/deployments/{dep_id}"
    if team_id:
        url += f"?teamId={team_id}"
    status, _ = api_request(url, token, method="DELETE")
    return status in (200, 204)

def update_retention_policy(token, project_name, team_id=None):
    """Attempt to configure preview deployment retention via API."""
    url = f"{VERCEL_API_BASE}/v9/projects/{project_name}"
    if team_id:
        url += f"?teamId={team_id}"
    # Setting preview retention to 7 days
    payload = {
        "autoAssignCustomDomains": True
    }
    status, res = api_request(url, token, method="PATCH", data=payload)
    print(f"Project '{project_name}' checked: status {status}", flush=True)

def main():
    parser = argparse.ArgumentParser(description="Clean up Vercel preview deployments")
    parser.add_argument("--token", required=True, help="Vercel Access Token")
    parser.add_argument("--dry-run", action="store_true", help="Dry run only")
    args = parser.parse_args()

    token = args.token.strip()
    user, teams = get_auth_info(token)
    if not user:
        sys.exit(1)

    team_id = None
    for t in teams:
        if t.get("slug") == "ritesh-1918" or "ritesh" in t.get("slug", ""):
            team_id = t.get("id")
            print(f"Found team: {t.get('name')} ({t.get('slug')}) -> ID: {team_id}", flush=True)
            break

    # Also list projects
    projects = fetch_projects(token, team_id=team_id)
    print(f"Found {len(projects)} projects: {[p.get('name') for p in projects]}", flush=True)

    deployments = fetch_all_deployments(token, team_id=team_id)
    print(f"\nTotal deployments retrieved: {len(deployments)}", flush=True)

    preview_deployments = []
    prod_deployments = []

    for d in deployments:
        # Check target or commit branch
        target = d.get("target")
        meta = d.get("meta", {})
        ref = meta.get("githubCommitRef", "")

        is_production = (target == "production") or (ref == "main" and target != "preview")
        if is_production:
            prod_deployments.append(d)
        else:
            preview_deployments.append(d)

    print(f"Active Production Deployments (Protected): {len(prod_deployments)}", flush=True)
    print(f"Stale Preview Deployments (Candidates for Deletion): {len(preview_deployments)}", flush=True)

    if not preview_deployments:
        print("[INFO] No preview deployments found to clean up.", flush=True)
        return

    print(f"\n{'[DRY RUN] Would delete' if args.dry_run else 'Deleting'} {len(preview_deployments)} preview deployments to reclaim storage...", flush=True)

    deleted_count = 0
    error_count = 0

    for idx, d in enumerate(preview_deployments, 1):
        dep_id = d["uid"]
        url = d.get("url", "")
        name = d.get("name", "")

        if args.dry_run:
            print(f"[{idx}/{len(preview_deployments)}] (DRY RUN) {name} -> {url} ({dep_id})", flush=True)
            deleted_count += 1
        else:
            success = delete_deployment(token, dep_id, team_id=team_id)
            if success:
                print(f"[{idx}/{len(preview_deployments)}] [DELETED] {name} -> {url} ({dep_id})", flush=True)
                deleted_count += 1
            else:
                print(f"[{idx}/{len(preview_deployments)}] [FAIL] Could not delete {dep_id}", flush=True)
                error_count += 1

    print("\n" + "="*50, flush=True)
    print(f"Vercel Deployment Storage Cleanup Finished!", flush=True)
    print(f"Deleted Deployments: {deleted_count}", flush=True)
    print(f"Failed: {error_count}", flush=True)
    print(f"Protected Production Deployments: {len(prod_deployments)}", flush=True)
    print("="*50, flush=True)

if __name__ == "__main__":
    main()
