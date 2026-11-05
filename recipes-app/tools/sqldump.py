"""Минимальный парсер INSERT ... VALUES (...) из SQL-дампа Postgres."""
import re


def iter_rows(path, table):
    """Возвращает кортежи значений из всех INSERT INTO "<table>" в дампе."""
    text = open(path, encoding="utf-8").read()
    head = re.compile(r'INSERT INTO "%s" \(([^)]*)\) VALUES\s*' % re.escape(table))
    for m in head.finditer(text):
        cols = [c.strip().strip('"') for c in m.group(1).split(",")]
        i = m.end()
        n = len(text)
        while i < n:
            while text[i] in " \t\r\n,":
                i += 1
            if text[i] == ";":
                break
            assert text[i] == "(", text[i:i + 50]
            i += 1
            row = []
            while True:
                while text[i] in " \t\r\n":
                    i += 1
                c = text[i]
                if c == "'":
                    i += 1
                    buf = []
                    while True:
                        j = text.index("'", i)
                        buf.append(text[i:j])
                        if j + 1 < n and text[j + 1] == "'":
                            buf.append("'")
                            i = j + 2
                        else:
                            i = j + 1
                            break
                    row.append("".join(buf))
                else:
                    m2 = re.compile(r"[^,)\s]+").match(text, i)
                    tok = m2.group(0)
                    i = m2.end()
                    if tok == "NULL":
                        row.append(None)
                    elif re.fullmatch(r"-?\d+", tok):
                        row.append(int(tok))
                    else:
                        row.append(tok)
                while text[i] in " \t\r\n":
                    i += 1
                if text[i] == ",":
                    i += 1
                    continue
                assert text[i] == ")"
                i += 1
                break
            yield dict(zip(cols, row))
