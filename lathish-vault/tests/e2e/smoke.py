import json, subprocess, time, re, sys
from playwright.sync_api import sync_playwright

srv = subprocess.Popen(["node", "scripts/dev-server.mjs"], cwd=__import__("os").path.dirname(__import__("os").path.dirname(__import__("os").path.dirname(__import__("os").path.abspath(__file__)))), env={"PORT": "3100", "PATH": "/usr/bin:/usr/local/bin"}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
time.sleep(1.5)
BASE = "http://localhost:3100"
now = "2026-10-30T10:00:00Z"
state = {"nodes": [
  {"id": "00000000-0000-4000-8000-000000000001", "parentId": None, "kind": "folder", "name": "Contracts", "size": 0, "mimeType": None, "status": "active", "favorite": False, "createdAt": now, "updatedAt": now},
  {"id": "00000000-0000-4000-8000-000000000002", "parentId": None, "kind": "file", "name": "notes.txt", "size": 1200, "mimeType": "text/plain", "status": "active", "favorite": True, "createdAt": now, "updatedAt": now},
], "n": 10, "uploaded": 0, "puts": 0}
def summary():
    used = sum(n["size"] for n in state["nodes"] if n["kind"] == "file")
    return {"displayName": "Lathish", "quotaBytes": 1000000000, "usedBytes": used, "reservedBytes": 0, "availableBytes": 1000000000 - used,
      "fileCount": sum(1 for n in state["nodes"] if n["kind"] == "file"), "folderCount": sum(1 for n in state["nodes"] if n["kind"] == "folder"),
      "trashCount": 0, "trashBytes": 0, "byType": [{"type": "documents", "count": 1, "bytes": 1200}], "history": [{"day": "2026-10-28", "usedBytes": 0}, {"day": "2026-10-29", "usedBytes": 500}, {"day": "2026-10-30", "usedBytes": used}],
      "uploadsByDay": [{"day": "2026-10-29", "count": 2}], "recentActivity": [{"id": 1, "action": "file.uploaded", "detail": {"name": "notes.txt"}, "at": now}]}
errors = []
def api(route, request):
    u = request.url.replace(BASE, ""); path = u.split("?")[0]; m = request.method
    def ok(body, status=200): route.fulfill(status=status, content_type="application/json", body=json.dumps(body))
    if path == "/api/auth/session": return ok({"authenticated": True, "email": "owner@example.com", "displayName": "Lathish"})
    if path == "/api/storage/summary": return ok(summary())
    if path == "/api/storage/events": return ok({"events": [{"id": 1, "action": "auth.login", "detail": {}, "at": now}]})
    if path == "/api/files/list":
        items = [n for n in state["nodes"] if n["status"] == "active"]
        return ok({"items": items, "total": len(items), "breadcrumbs": []})
    if path == "/api/uploads/init":
        body = json.loads(request.post_data); state["pending"] = body
        return ok({"sessionId": "00000000-0000-4000-8000-0000000000aa", "nodeId": "x", "name": body["name"], "size": body["size"], "contentType": "text/plain", "multipart": False, "url": "https://bkt.s3.us-west-004.backblazeb2.com/objects/abc?X-Amz-Signature=s", "expiresAt": now}, 201)
    if path == "/api/uploads/complete":
        b = state["pending"]; state["nodes"].append({"id": "00000000-0000-4000-8000-00000000%04d" % state["n"], "parentId": None, "kind": "file", "name": b["name"], "size": b["size"], "mimeType": "text/plain", "status": "active", "favorite": False, "createdAt": now, "updatedAt": now}); state["n"] += 1; state["uploaded"] += 1
        return ok({"node": {}})
    if path == "/api/folders/create":
        b = json.loads(request.post_data); state["nodes"].append({"id": "00000000-0000-4000-8000-00000000%04d" % state["n"], "parentId": None, "kind": "folder", "name": b["name"], "size": 0, "mimeType": None, "status": "active", "favorite": False, "createdAt": now, "updatedAt": now}); state["n"] += 1
        return ok({"node": {}}, 201)
    return ok({"error": {"code": "not_found", "message": "unmocked " + path}}, 404)
def b2(route, request):
    h = {"access-control-allow-origin": BASE, "access-control-allow-headers": "*", "access-control-allow-methods": "PUT,GET"}
    if request.method == "PUT": state["puts"] += 1
    route.fulfill(status=200, headers=h, body="")

with sync_playwright() as p:
    br = p.chromium.launch(); res = {}
    ctx = br.new_context(viewport={"width": 1366, "height": 820}); page = ctx.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.route("**/api/**", api); page.route("https://*.backblazeb2.com/**", b2)
    # login page
    page.goto(BASE + "/login.html"); page.wait_for_timeout(1200); page.screenshot(path="/tmp/lv-shots/login.png")
    res["login_form_visible"] = page.locator("#login-form").is_visible()
    # session mocked as authenticated => login.js redirects to dashboard
    page.wait_for_url("**/dashboard.html**", timeout=5000); page.wait_for_timeout(1500)
    res["dashboard_welcome"] = page.locator(".hero h1").inner_text()
    res["quota_text"] = page.locator("#side-storage").inner_text().replace("\n", " | ")
    res["ticker_sim_tag"] = page.locator(".sim-tag").inner_text()
    page.screenshot(path="/tmp/lv-shots/dashboard.png")
    # explorer
    page.click("a[data-nav=files]"); page.wait_for_selector(".item", timeout=5000); page.wait_for_timeout(400)
    res["items"] = page.locator(".item .name").all_inner_texts()
    page.screenshot(path="/tmp/lv-shots/files.png")
    # new folder via dialog
    page.click("text=New folder"); page.fill("#dlg-in", "Invoices"); page.keyboard.press("Enter"); page.wait_for_timeout(700)
    res["after_folder"] = page.locator(".item .name").all_inner_texts()
    # upload via file input (direct PUT to mocked B2)
    page.set_input_files("#file-input", {"name": "hello.txt", "mimeType": "text/plain", "buffer": b"hello vault"}); page.wait_for_timeout(1500)
    res["b2_puts"] = state["puts"]; res["completed"] = state["uploaded"]
    res["after_upload"] = page.locator(".item .name").all_inner_texts()
    res["upload_panel"] = page.locator("#uploads").inner_text().replace("\n", " | ")
    # select + details panel, list view, keyboard nav
    page.click(".item:has-text('notes.txt')"); page.wait_for_timeout(300)
    res["details_visible"] = page.locator("aside.details").is_visible()
    page.click("button[aria-label='List view']"); page.wait_for_timeout(300); page.screenshot(path="/tmp/lv-shots/files_list.png")
    page.click(".item:has-text('notes.txt') .more"); page.wait_for_timeout(200)
    res["ctx_menu"] = page.locator("#ctx button").all_inner_texts()
    page.keyboard.press("Escape")
    # analytics + security pages
    for nav in ("analytics", "security", "settings"):
        page.click(f"a[data-nav={nav}]"); page.wait_for_timeout(700); page.screenshot(path=f"/tmp/lv-shots/{nav}.png")
    # mobile
    m = br.new_context(viewport={"width": 390, "height": 800}); mp = m.new_page(); mp.route("**/api/**", api)
    mp.goto(BASE + "/dashboard.html#/dashboard"); mp.wait_for_timeout(1500); mp.screenshot(path="/tmp/lv-shots/mobile.png")
    mp.click("#menu-btn"); mp.wait_for_timeout(500); mp.screenshot(path="/tmp/lv-shots/mobile_nav.png")
    br.close()
print(json.dumps(res, indent=1))
print("CONSOLE ERRORS/WARNINGS:", json.dumps(errors, indent=1))
srv.terminate()
