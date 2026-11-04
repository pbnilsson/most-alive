import asyncio, sys, json
from playwright.async_api import async_playwright

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5
SHOT = "/tmp/claude-0/shots"
NAMES = ["Maria", "Sam", "Priya", "Jonah", "Elena", "Theo", "Ana"]
TEXTS = [
    "I was nineteen, standing at the edge of a cold lake in Maine at dawn. The water was so still it held the whole sky. I jumped in before I could think, and the shock of it emptied my head of every worry. For a few seconds I was nothing but a body and a heartbeat and the sound of loons.",
    "The night my daughter was born, the hospital was quiet and the lights were low. I remember holding her and feeling the whole world narrow to the weight of her in my arms. I was exhausted and terrified and completely, ridiculously happy.",
    "Teaching my first class, I forgot my notes on the train. I had to just talk with the students, really talk, and somewhere in the middle a quiet kid in the back asked a question that changed the whole hour. I felt awake in a way I hadn't for years.",
    "Climbing the last switchback on a mountain in Colorado, my legs were shaking and the air was thin. At the top the wind hit me and I could see three states. I laughed out loud for no reason at all.",
    "Singing in a choir at my grandmother's funeral, our voices cracked on the last verse. Grief and gratitude were in the same breath. I have never felt so connected to a room full of people.",
    "Riding a bicycle down a long hill in the rain with my brother, both of us shouting, soaked to the skin, not caring at all about being late for dinner.",
    "The first time I read a poem aloud that I had written myself, my hands shook, and then the room went silent, and then someone said, read it again.",
]

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1300, "height": 805*(N+1)})
        errors = []
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append(str(e)))
        async def on_dialog(d):
            if d.type == "prompt": await d.accept("Practice")
            else: await d.accept()
        pg.on("dialog", on_dialog)
        await pg.goto(f"http://localhost:8123/test/harness.html?n={N}")
        await pg.wait_for_timeout(1500)
        F = lambda id: pg.frame_locator(f"#{id}")
        frames = {f.name or f.url: f for f in pg.frames}
        def fr(id):
            for f in pg.frames:
                if f.url.endswith(("uid=" + id) if id != "host" else "host.html?mock=1"): return f
        host = fr("host")
        await host.click("#newsess"); await pg.wait_for_timeout(500)
        ps = [f"p{i}" for i in range(1, N + 1)]
        for i, pid in enumerate(ps):
            f = fr(pid)
            await f.fill("input[name=first]", NAMES[i]); await f.fill("input[name=email]", f"{NAMES[i].lower()}@example.org")
            await f.click("button[type=submit]")
        await pg.wait_for_timeout(600)
        await host.click("#start"); await pg.wait_for_timeout(600)
        for i, pid in enumerate(ps):
            await fr(pid).fill("#ta", TEXTS[i])
        await fr("p1").locator("main").screenshot(path=f"{SHOT}/01-writing-locked.png") if False else None
        await pg.locator("#p1").screenshot(path=f"{SHOT}/01-writing.png")
        dis = await fr("p1").locator("#submit").is_disabled()
        print("submit locked before 8 min:", dis)
        async def adv(minutes):
            await pg.evaluate(f"window.__mockDB.offset += {minutes}*60000")
            await pg.wait_for_timeout(1300)
        await adv(9.3)
        await pg.locator("#p1").screenshot(path=f"{SHOT}/02-writing-banner.png")
        # Staggered submits
        for pid in ps:
            await fr(pid).click("#submit"); await pg.wait_for_timeout(250)
        await pg.wait_for_timeout(1500)
        async def phases():
            out = {}
            for pid in ps:
                out[pid] = await pg.evaluate(f"(()=>{{const d=window.__mockDB.docs; for (const [k,v] of d) if (k.endsWith('/people/{pid}')) return v.phase+':'+(v.holding||'')+':'+(v.readsDone||0); }})()")
            return out
        print("after writing:", await phases())
        await adv(0.5)  # 30s waiting → rescue
        await pg.wait_for_timeout(8000)
        print("after rescue window:", await phases())

        async def reflect(pid, k):
            f = fr(pid)
            if await f.locator(".doc").count() == 0: return False
            await f.evaluate(f"""(() => {{
              const spans=[...document.querySelectorAll('.doc span[data-off]')];
              const s = spans.find(x=>x.textContent.length>40) || spans[0];
              const tn=s.firstChild; const r=document.createRange();
              const st = Math.min(tn.length-5, 3+{k}*25);
              r.setStart(tn, st); r.setEnd(tn, Math.min(tn.length, st+22));
              const sel=getSelection(); sel.removeAllRanges(); sel.addRange(r);
              document.querySelector('.doc').dispatchEvent(new MouseEvent('mouseup',{{bubbles:true}}));
            }})()""")
            await pg.wait_for_timeout(200)
            await f.click(".add-btn")
            await f.fill(".card.draft textarea", f"This reminds me of a summer when I was twelve and felt the same rush — reflection {k} from {pid}.")
            await f.click(".card.draft .btn.primary")
            await pg.wait_for_timeout(300)
            return True
        for pid in ps:
            await reflect(pid, 0); await reflect(pid, 1)
        await pg.locator("#p2").screenshot(path=f"{SHOT}/03-round1.png")
        print("r1 submit locked:", await fr("p2").locator("#submit").is_disabled())
        await adv(16.6 - 9.8)
        for pid in ps:
            f = fr(pid)
            if await f.locator("#submit").count() and not await f.locator("#submit").is_disabled():
                await f.click("#submit"); await pg.wait_for_timeout(250)
        await pg.wait_for_timeout(2000)
        print("after round 1:", await phases())
        await adv(0.5); await pg.wait_for_timeout(8000)
        print("after r2 rescue window:", await phases())
        for pid in ps:
            ok = await reflect(pid, 2)
            f = fr(pid)
            if ok and await f.locator(".card .reply-btn").count():
                await f.locator(".card:not(.mine) .reply-btn").first.click()
                await f.fill(".reply-form textarea", f"Yes — and for me it was my grandfather's workshop. ({pid})")
                await f.click(".reply-form .btn.primary"); await pg.wait_for_timeout(300)
        await pg.locator("#p3").screenshot(path=f"{SHOT}/04-round2.png")
        await adv(24.6 - 17.6)
        for pid in ps:
            f = fr(pid)
            if await f.locator("#submit").count() and not await f.locator("#submit").is_disabled():
                await f.click("#submit"); await pg.wait_for_timeout(250)
        await pg.wait_for_timeout(2500)
        print("after round 2:", await phases())
        for pid in ps:
            t = await fr(pid).locator("#bar").inner_text()
            print(pid, "bar:", t.replace("\n", " | "))
        await pg.locator("#p1").screenshot(path=f"{SHOT}/05-return.png")
        await pg.locator("#host").screenshot(path=f"{SHOT}/06-host.png")
        pieces = await pg.evaluate("(()=>{const o={};for(const [k,v] of window.__mockDB.docs){const m=k.match(/pieces\\/(p\\d)$/); if(m) o[m[1]]={readers:v.readers,status:v.status};} return o;})()")
        print("pieces:", json.dumps(pieces))
        # PNG export
        async with pg.expect_download() as dl:
            await host.locator("[data-png]").first.click()
        d = await dl.value; await d.save_as(f"{SHOT}/07-export.png")
        print("errors:", errors[:10])
        await b.close()

asyncio.run(main())
