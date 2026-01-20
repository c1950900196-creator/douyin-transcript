#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抖音视频语音转文字 - 本地 Whisper 模型
无需API，完全离线运行

使用方法：
    python transcribe.py <音频文件路径> [模型大小]
    
模型大小选项：
    tiny    - 最快，精度较低（约75MB）
    base    - 较快，精度一般（约142MB）
    small   - 中等速度，精度较好（约466MB）- 默认
    medium  - 较慢，精度很好（约1.5GB）
    large   - 最慢，精度最高（约2.9GB）
    
首次运行会自动下载模型
"""

import sys
import os
import json
import ssl
import urllib.request

# 修复 macOS SSL 证书问题
def fix_ssl():
    """修复 macOS 上的 SSL 证书验证问题"""
    try:
        # 创建不验证证书的上下文
        ssl._create_default_https_context = ssl._create_unverified_context
        print("SSL 证书验证已禁用", file=sys.stderr)
    except Exception as e:
        print(f"SSL 修复警告: {e}", file=sys.stderr)

# 添加自定义 FFmpeg 路径到 PATH
def fix_ffmpeg_path():
    """将自定义 FFmpeg 路径添加到 PATH"""
    # 检查配置文件
    config_path = os.path.join(os.path.dirname(__file__), 'config.json')
    ffmpeg_dir = None
    
    # 方法1: 从配置文件读取
    if os.path.exists(config_path):
        try:
            with open(config_path, 'r') as f:
                config = json.load(f)
                if config.get('ffmpegPath'):
                    ffmpeg_dir = os.path.dirname(config['ffmpegPath'])
        except:
            pass
    
    # 方法2: 检查默认下载位置
    if not ffmpeg_dir:
        home = os.path.expanduser('~')
        default_ffmpeg = os.path.join(home, '.ffmpeg', 'ffmpeg')
        if os.path.exists(default_ffmpeg):
            ffmpeg_dir = os.path.dirname(default_ffmpeg)
    
    # 添加到 PATH
    if ffmpeg_dir and os.path.isdir(ffmpeg_dir):
        current_path = os.environ.get('PATH', '')
        if ffmpeg_dir not in current_path:
            os.environ['PATH'] = ffmpeg_dir + os.pathsep + current_path
            print(f"已添加 FFmpeg 路径: {ffmpeg_dir}", file=sys.stderr)

# 启动时修复 SSL 和 FFmpeg 路径
fix_ssl()
fix_ffmpeg_path()

def check_dependencies():
    """检查并安装依赖"""
    missing = []
    
    try:
        import whisper
    except ImportError:
        missing.append("openai-whisper")
    
    try:
        import opencc
    except ImportError:
        missing.append("opencc-python-reimplemented")
    
    try:
        import pysbd
    except ImportError:
        missing.append("pysbd")
    
    if missing:
        print(f"正在安装依赖: {', '.join(missing)}...", file=sys.stderr)
        import subprocess
        try:
            subprocess.check_call([
                sys.executable, "-m", "pip", "install", 
                *missing, "-q",
                "-i", "https://pypi.tuna.tsinghua.edu.cn/simple"
            ])
            return True
        except Exception as e:
            print(f"安装失败: {e}", file=sys.stderr)
            return False
    return True


def convert_to_simplified(text):
    """将繁体中文转换为简体中文"""
    try:
        import opencc
        converter = opencc.OpenCC('t2s')  # 繁体转简体
        return converter.convert(text)
    except Exception as e:
        print(f"繁简转换失败: {e}", file=sys.stderr)
        return text


def add_punctuation(text):
    """智能断句：结合规则和 PySBD"""
    import re
    
    # 如果文本为空，直接返回
    if not text or not text.strip():
        return text
    
    # 检查是否已经有标点
    has_punctuation = bool(re.search(r'[，。！？、；：,.!?]', text))
    
    # 如果没有标点，先用规则添加基础断句
    if not has_punctuation:
        text = rule_based_punctuation(text)
    
    # 然后用 PySBD 优化
    try:
        import pysbd
        segmenter = pysbd.Segmenter(language="zh", clean=False)
        sentences = segmenter.segment(text)
        
        if sentences and len(sentences) > 1:
            # PySBD 成功分句了，重新组合
            result = ''.join(s.strip() for s in sentences if s.strip())
        else:
            result = text
            
    except Exception as e:
        print(f"PySBD 优化失败: {e}", file=sys.stderr)
        result = text
    
    # 最终清理
    result = re.sub(r'[，,]+', '，', result)
    result = re.sub(r'[。.]+', '。', result)
    result = re.sub(r'，。', '。', result)
    result = re.sub(r'。，', '。', result)
    
    # 确保句末有句号
    if result and result[-1] not in '。！？…':
        result += '。'
    
    return result


def rule_based_punctuation(text):
    """基于规则的中文断句"""
    import re
    
    if not text:
        return text
    
    result = text
    
    # ========== 第一步：在关键词前后添加标点 ==========
    
    # 句首连接词（在这些词前面断句）
    sentence_starters = [
        '但是', '不过', '然后', '所以', '因为', '如果', '虽然',
        '而且', '或者', '还有', '另外', '总之', '其实', '当然',
        '首先', '其次', '最后', '接下来', '那么', '这样',
        '比如', '例如', '就是', '也就是说', '换句话说',
        '一方面', '另一方面', '不仅', '而是', '反而',
        '于是', '因此', '可是', '然而', '尽管', '即使',
        '要么', '否则', '不然', '总的来说', '综上所述'
    ]
    
    # 在这些词前添加逗号或句号
    for word in sentence_starters:
        # 在词前加逗号（如果前面不是标点）
        result = re.sub(f'([^，。！？、；：])({word})', r'\1，\2', result)
    
    # ========== 第二步：在句末语气词后添加标点 ==========
    
    # 句末语气词（这些词后面应该断句）
    sentence_enders = {
        # 疑问语气 -> 问号
        '吗': '？', '呢': '？', '吧': '。', '么': '？',
        # 感叹语气 -> 感叹号或句号
        '啊': '！', '呀': '！', '哦': '。', '哈': '！',
        '嘛': '。', '啦': '！', '哎': '，', '唉': '，',
        # 陈述语气 -> 句号或逗号
        '了': '，', '的': '，', '着': '，', '过': '，',
    }
    
    # 在语气词后添加标点（如果后面还有很多字）
    for word, punct in sentence_enders.items():
        # 只在语气词后面还有至少8个字符时添加标点
        result = re.sub(f'({word})([^，。！？、；：]{{8,}})', rf'\1{punct}\2', result)
    
    # ========== 第三步：按长度断句 ==========
    
    # 如果某段太长没有标点，按固定间隔添加逗号
    segments = re.split(r'([，。！？、；：])', result)
    new_segments = []
    
    for i, seg in enumerate(segments):
        if i % 2 == 0:  # 内容段
            # 如果段落超过40个字，尝试在中间断句
            if len(seg) > 40:
                seg = insert_comma_by_length(seg, max_len=25)
        new_segments.append(seg)
    
    result = ''.join(new_segments)
    
    # ========== 第四步：处理特殊情况 ==========
    
    # 问句结尾
    question_patterns = [
        r'(是不是[^，。！？]*)',
        r'(有没有[^，。！？]*)',
        r'(能不能[^，。！？]*)',
        r'(什么[^，。！？]*)',
        r'(怎么[^，。！？]*)',
        r'(为什么[^，。！？]*)',
        r'(哪里[^，。！？]*)',
        r'(多少[^，。！？]*)',
    ]
    
    for pattern in question_patterns:
        result = re.sub(pattern + r'([，。])', r'\1？\2', result)
    
    return result


def insert_comma_by_length(text, max_len=25):
    """在长文本中按长度插入逗号"""
    if len(text) <= max_len:
        return text
    
    # 尝试在合适的位置断句
    break_chars = ['的', '了', '是', '在', '有', '和', '就', '也', '都', '要', '能', '会', '把', '被', '让', '给']
    
    result = []
    current_len = 0
    chars = list(text)
    
    for i, char in enumerate(chars):
        result.append(char)
        current_len += 1
        
        # 如果当前长度超过 max_len，尝试在下一个合适位置断句
        if current_len >= max_len and char in break_chars:
            # 检查后面是否还有足够的字符
            remaining = len(chars) - i - 1
            if remaining > 5:  # 后面还有超过5个字符
                result.append('，')
                current_len = 0
    
    return ''.join(result)

def get_audio_duration(audio_path):
    """获取音频时长（秒）"""
    try:
        import subprocess
        result = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-show_entries', 'format=duration', 
             '-of', 'default=noprint_wrappers=1:nokey=1', audio_path],
            capture_output=True, text=True
        )
        return float(result.stdout.strip())
    except:
        return 0


def convert_video_to_audio(video_path):
    """
    将视频文件转换为 WAV 音频（处理 HEVC 等特殊编码）
    """
    import subprocess
    import tempfile
    
    # 创建临时音频文件
    temp_audio = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    temp_audio_path = temp_audio.name
    temp_audio.close()
    
    print(f"转换视频为音频: {video_path} -> {temp_audio_path}", file=sys.stderr)
    
    # 使用 FFmpeg 转换，指定输出格式为 16kHz 单声道 PCM
    cmd = [
        'ffmpeg', '-y', '-i', video_path,
        '-vn',  # 不要视频
        '-acodec', 'pcm_s16le',  # PCM 16-bit 编码
        '-ar', '16000',  # 16kHz 采样率（Whisper 需要）
        '-ac', '1',  # 单声道
        temp_audio_path
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode == 0 and os.path.exists(temp_audio_path):
            print(f"音频转换成功", file=sys.stderr)
            return temp_audio_path
        else:
            print(f"FFmpeg 错误: {result.stderr}", file=sys.stderr)
            raise Exception(f"音频转换失败: {result.stderr}")
    except subprocess.TimeoutExpired:
        raise Exception("音频转换超时")
    except FileNotFoundError:
        raise Exception("未找到 FFmpeg，请确保已安装")


def transcribe_audio(audio_path, model_size="small"):
    """
    使用Whisper模型转写音频
    
    Args:
        audio_path: 音频文件路径（支持音频或视频文件）
        model_size: 模型大小 (tiny/base/small/medium/large)
    
    Returns:
        转写的文本（简体中文，带标点）
    """
    import whisper
    import numpy as np
    
    # 检查文件是否存在
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"音频文件不存在: {audio_path}")
    
    # 如果是视频文件，先转换为音频
    temp_audio = None
    file_ext = os.path.splitext(audio_path)[1].lower()
    video_extensions = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv']
    
    if file_ext in video_extensions:
        print(f"检测到视频文件，正在转换为音频...", file=sys.stderr)
        try:
            temp_audio = convert_video_to_audio(audio_path)
            audio_path = temp_audio
        except Exception as e:
            print(f"视频转音频失败: {e}", file=sys.stderr)
            # 继续尝试直接用 Whisper 处理
    
    # 获取音频时长
    audio_duration = get_audio_duration(audio_path)
    print(f"音频时长: {audio_duration:.1f} 秒", file=sys.stderr)
    
    # 加载模型（首次会自动下载）
    print(f"加载Whisper模型 ({model_size})...", file=sys.stderr)
    # 输出进度: 加载模型阶段 0-10%
    print("PROGRESS:5", file=sys.stderr)
    sys.stderr.flush()
    
    model = whisper.load_model(model_size)
    print("PROGRESS:10", file=sys.stderr)
    sys.stderr.flush()
    
    # 加载并处理音频
    print("加载音频...", file=sys.stderr)
    audio = whisper.load_audio(audio_path)
    print("PROGRESS:15", file=sys.stderr)
    sys.stderr.flush()
    
    # Whisper 每 30 秒处理一个片段
    # 估算总片段数
    total_duration = len(audio) / whisper.audio.SAMPLE_RATE
    segment_duration = 30  # Whisper 每次处理 30 秒
    total_segments = max(1, int(np.ceil(total_duration / segment_duration)))
    
    print(f"预计处理 {total_segments} 个音频片段", file=sys.stderr)
    
    # 使用自定义的转写方法来跟踪进度
    # 我们使用 whisper 的底层方法来分段处理
    
    # 填充/修剪音频到 30 秒的倍数
    audio = whisper.pad_or_trim(audio, length=len(audio))
    
    # 获取 mel 频谱图
    print("PROGRESS:20", file=sys.stderr)
    sys.stderr.flush()
    mel = whisper.log_mel_spectrogram(audio).to(model.device)
    
    # 检测语言
    print("PROGRESS:25", file=sys.stderr)
    sys.stderr.flush()
    
    # 转写 - 使用回调来报告进度
    print("正在转写...", file=sys.stderr)
    
    # 创建一个进度跟踪器
    processed_segments = [0]
    last_progress = [25]
    
    def progress_callback(seek):
        """进度回调函数"""
        if audio_duration > 0:
            # seek 是当前处理的采样点位置
            current_time = seek / whisper.audio.SAMPLE_RATE
            progress = 25 + int((current_time / total_duration) * 65)  # 25% 到 90%
            if progress > last_progress[0] + 2:  # 每增加 2% 报告一次
                last_progress[0] = progress
                print(f"PROGRESS:{min(progress, 90)}", file=sys.stderr)
                sys.stderr.flush()
    
    # 使用标准转写，但通过分析 segments 来估算进度
    result = model.transcribe(
        audio_path,
        language="zh",
        verbose=False,
        temperature=0,
        best_of=5,
        beam_size=5,
        condition_on_previous_text=True,
    )
    
    # 转写完成
    print("PROGRESS:90", file=sys.stderr)
    sys.stderr.flush()
    
    text = result["text"]
    
    # 繁体转简体
    print("转换为简体中文...", file=sys.stderr)
    print("PROGRESS:93", file=sys.stderr)
    sys.stderr.flush()
    text = convert_to_simplified(text)
    
    # 添加标点符号
    print("添加标点符号...", file=sys.stderr)
    print("PROGRESS:97", file=sys.stderr)
    sys.stderr.flush()
    text = add_punctuation(text)
    
    print("PROGRESS:100", file=sys.stderr)
    sys.stderr.flush()
    
    # 清理临时音频文件
    if temp_audio and os.path.exists(temp_audio):
        try:
            os.remove(temp_audio)
            print(f"已清理临时文件: {temp_audio}", file=sys.stderr)
        except:
            pass
    
    return text

def main():
    if len(sys.argv) < 2:
        print("用法: python transcribe.py <音频文件路径> [模型大小]", file=sys.stderr)
        print("模型大小: tiny, base, small(默认), medium, large", file=sys.stderr)
        sys.exit(1)
    
    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "small"
    
    # 验证模型大小
    valid_models = ["tiny", "base", "small", "medium", "large"]
    if model_size not in valid_models:
        print(f"无效的模型大小: {model_size}", file=sys.stderr)
        print(f"可选: {', '.join(valid_models)}", file=sys.stderr)
        sys.exit(1)
    
    # 检查依赖
    if not check_dependencies():
        print(json.dumps({
            "success": False,
            "error": "无法安装whisper依赖，请手动运行: pip install openai-whisper"
        }))
        sys.exit(1)
    
    try:
        text = transcribe_audio(audio_path, model_size)
        # 输出JSON结果
        print(json.dumps({
            "success": True,
            "text": text.strip()
        }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }, ensure_ascii=False))
        sys.exit(1)

if __name__ == "__main__":
    main()

