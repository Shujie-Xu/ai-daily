#!/usr/bin/env python3
"""
AI Daily · TTS 生成器
从 stdin 读取文本，生成 edge-tts 音频到 argv[1] 路径
用法: echo "text" | python3 tts_gen.py output.mp3
"""
import asyncio, sys, os
import edge_tts

VOICE = "zh-CN-XiaoxiaoNeural"

async def main():
    output = sys.argv[1]
    text = sys.stdin.read().strip()
    if not text:
        print("⚠️ tts_gen: empty text, skipping", file=sys.stderr)
        sys.exit(1)

    communicate = edge_tts.Communicate(text, VOICE, rate="+5%", volume="+0%")
    tmp_output = output + ".raw.mp3"
    await communicate.save(tmp_output)

    # 用 ffmpeg 压缩：单声道 64kbps，体积降至约 1/4
    import subprocess
    r = subprocess.run(
        ["ffmpeg", "-y", "-i", tmp_output,
         "-ac", "1", "-b:a", "32k", output],
        capture_output=True
    )
    os.unlink(tmp_output)

    if r.returncode != 0:
        # ffmpeg 失败时直接用原始文件
        os.rename(tmp_output if os.path.exists(tmp_output) else output, output)

    size = os.path.getsize(output)
    print(f"✅ TTS: {os.path.basename(output)} ({size//1024}KB)", file=sys.stderr)

asyncio.run(main())
