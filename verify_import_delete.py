import asyncio
from playwright.async_api import async_playwright
import json
import os

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context()
        page = await context.new_page()

        # Load the app
        await page.goto(f'file://{os.getcwd()}/index.html')

        # Open Settings dropdown
        await page.click('#settings-dropdown .dropdown-header')

        # Give it a moment to expand
        await page.wait_for_timeout(1000)

        # Enable Creation Mode
        # The input is hidden, but the parent label or the slider is visible?
        # Let's try to click the label or force click the input
        await page.click('label[for="creation-mode-toggle"]', force=True)

        # Check for buttons
        import_btn = page.locator('#import-creation-data-btn')
        delete_btn = page.locator('#delete-creation-data-btn')

        # Wait for buttons
        await page.wait_for_timeout(500)

        if await import_btn.is_visible() and await delete_btn.is_visible():
            print("Buttons are visible.")
        else:
            print("Buttons are NOT visible.")
            # Let's check why
            await page.screenshot(path='/home/jules/verification/debug_settings.png')
            await browser.close()
            return

        # Take screenshot of settings menu
        await page.screenshot(path='/home/jules/verification/settings_with_new_buttons.png')

        # Test Delete functionality
        # Set some initial data in localStorage
        initial_data = {
            "nodes": [{"id": "test", "x": 100, "y": 100, "label": "Test", "type": "poi"}],
            "edges": []
        }
        await page.evaluate(f"localStorage.setItem('creation-mapping', '{json.dumps(initial_data)}')")
        await page.reload()

        # Re-open dropdown
        await page.click('#settings-dropdown .dropdown-header')
        await page.wait_for_timeout(1000)
        await page.click('label[for="creation-mode-toggle"]', force=True)

        # Click Delete and handle confirm
        page.on("dialog", lambda dialog: dialog.accept())
        await page.click('#delete-creation-data-btn')

        # Verify data is cleared in localStorage
        saved_data = await page.evaluate("localStorage.getItem('creation-mapping')")
        data_json = json.loads(saved_data)
        if len(data_json['nodes']) == 0 and len(data_json['edges']) == 0:
            print("Delete functionality verified: data cleared.")
        else:
            print(f"Delete functionality failed: data still exists. {saved_data}")

        # Test Import functionality
        import_data = {
            "nodes": [{"id": "imported", "x": 200, "y": 200, "label": "Imported", "type": "poi"}],
            "edges": []
        }
        with open('test_import.json', 'w') as f:
            json.dump(import_data, f)

        # Handle alert after import
        page.on("dialog", lambda dialog: dialog.accept())

        async with page.expect_file_chooser() as fc_info:
            await page.click('#import-creation-data-btn')
        file_chooser = await fc_info.value
        await file_chooser.set_files("test_import.json")

        # Verify data is imported
        saved_data = await page.evaluate("localStorage.getItem('creation-mapping')")
        data_json = json.loads(saved_data)
        if data_json['nodes'][0]['id'] == 'imported':
            print("Import functionality verified: data loaded.")
        else:
            print(f"Import functionality failed. {saved_data}")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
