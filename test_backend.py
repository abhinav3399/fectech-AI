import httpx
import asyncio

async def test():
    try:
        r = await httpx.AsyncClient().post('http://localhost:8000/api/v1/generate-3d', json={'image':'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='})
        print(r.status_code)
        print(r.json())
    except Exception as e:
        print("Error:", e)

asyncio.run(test())
