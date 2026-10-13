"""Make artifact.html: same page without <html>/<head>/<body> wrappers (the host adds them)."""
import pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
s = (root / "index.html").read_text(encoding="utf-8")
head = re.search(r"<head>(.*?)</head>", s, re.S).group(1)
body = re.search(r"<body>(.*?)</body>", s, re.S).group(1)
head = re.sub(r'<meta charset[^>]*>\s*|<meta name="viewport"[^>]*>\s*', "", head)
# title first so the host finds it
title = re.search(r"<title>.*?</title>", head, re.S).group(0)
head = head.replace(title, "")
(root / "artifact.html").write_text("<title>QuoteLens</title>\n" + head.strip() + "\n" + body.strip() + "\n", encoding="utf-8")
print("artifact.html written")
