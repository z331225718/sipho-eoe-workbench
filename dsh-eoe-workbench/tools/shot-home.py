from playwright.sync_api import sync_playwright
url = "http://127.0.0.1:3091/?token=FdkEgH5btK74JmCr_iC5-gfGNB1M3aNb-lYpVB8_dTQ"
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1500, "height": 1000})
    errors = []
    page.on("console", lambda msg: errors.append(f"console:{msg.type}:{msg.text}") if msg.type in ("error","warning") else None)
    page.on("pageerror", lambda err: errors.append(f"pageerror:{err}"))
    page.goto(url, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(3000)
    print("TITLE", page.title())
    print("URL", page.url)
    print("TEXT", page.locator("body").inner_text()[:4000])
    print("ERRORS", errors[:20])
    page.screenshot(path="docs/screenshots/dsh-home.png", full_page=True)
    browser.close()
