# -*- coding: utf-8 -*-
"""极简静态服务器（离线预览用）。

用法：
    python tools/serve.py                 # 默认 127.0.0.1:8790，自动打开浏览器
    python tools/serve.py --port 9000 --no-browser

说明：
- 用 ThreadingHTTPServer，单个请求卡住不会阻塞其它请求（旧版单线程会整体卡死）
- 端口被占用时自动往后找一个可用端口
- 所有输出都包了容错：即使控制台被关掉（stdout 失效）也不会因此卡死
"""
import argparse
import http.server
import os
import socket
import socketserver
import threading
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
}


def say(msg):
    try:
        print(msg, flush=True)
    except Exception:
        pass


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def guess_type(self, path):
        ext = os.path.splitext(str(path))[1].lower()
        return MIME.get(ext) or super().guess_type(path)

    def log_message(self, fmt, *args):
        say("  %s" % (fmt % args))

    def end_headers(self):
        # 开发期禁用缓存，避免浏览器拿着旧的 js/css 不放（改完刷新即生效）
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
            self.close_connection = True


def free_port(start, tries=20):
    for p in range(start, start + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    raise SystemExit("找不到可用端口（%d-%d 都被占用了）" % (start, start + tries))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--no-browser", action="store_true")
    ns = ap.parse_args()

    port = free_port(ns.port)
    if port != ns.port:
        say("端口 %d 被占用，改用 %d" % (ns.port, port))

    class Server(http.server.ThreadingHTTPServer):
        daemon_threads = True
        allow_reuse_address = True

    with Server(("127.0.0.1", port), Handler) as httpd:
        url = "http://127.0.0.1:%d/" % port
        say("服务已启动：%s" % url)
        say("（按 Ctrl+C 停止；关掉本窗口即停止服务）")
        if not ns.no_browser:
            threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            say("\n已停止。")


if __name__ == "__main__":
    main()
