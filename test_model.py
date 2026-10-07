import httpx
import asyncio
import time

async def test():
    try:
        r = await httpx.AsyncClient().post('http://127.0.0.1:8800/submit', json={'image':'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='})
        task_id = r.json()['task_id']
        print(f"Task ID: {task_id}")
        
        for i in range(10):
            r = await httpx.AsyncClient().get(f'http://127.0.0.1:8800/status/{task_id}')
            data = r.json()
            print(data)
            if data['status'] in ('SUCCEEDED', 'FAILED'):
                break
            time.sleep(2)
    except Exception as e:
        print("Error:", e)

asyncio.run(test())

