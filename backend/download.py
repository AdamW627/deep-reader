"""Public-only, DNS-pinned downloads. Redirects are validated independently."""
import ipaddress
import socket
import ssl
import http.client
from html.parser import HTMLParser
from urllib.parse import urlsplit, urljoin, urlunsplit
from fastapi import HTTPException

MAX_BYTES = 60 * 1024 * 1024


def public_target(url):
    p = urlsplit(url)
    if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password:
        raise HTTPException(400, 'Only public HTTP(S) URLs without credentials are allowed')
    if p.port not in (None, 80, 443):
        raise HTTPException(400, 'Only ports 80 and 443 are allowed')
    try:
        addresses = socket.getaddrinfo(p.hostname, p.port or (443 if p.scheme == 'https' else 80), type=socket.SOCK_STREAM)
    except OSError:
        raise HTTPException(400, 'URL hostname could not be resolved')
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise HTTPException(400, 'Private, local, or reserved URL addresses are forbidden')
    return p, addresses[0][4][0]


class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host, ip, port):
        super().__init__(host, port, timeout=30, context=ssl.create_default_context())
        self.ip = ip

    def connect(self):
        raw = socket.create_connection((self.ip, self.port), self.timeout)
        self.sock = self._context.wrap_socket(raw, server_hostname=self.host)


class Metadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.pdf = None
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'meta' and a.get('name', '').lower() == 'citation_pdf_url':
            self.pdf = a.get('content')


def download(url, metadata=True):
    p = urlsplit(url)
    if p.hostname in ('arxiv.org', 'www.arxiv.org') and p.path.startswith('/abs/'):
        url = urlunsplit(('https', 'arxiv.org', '/pdf/' + p.path[5:], '', ''))
    for _ in range(6):
        p, ip = public_target(url)
        port = p.port or (443 if p.scheme == 'https' else 80)
        conn = PinnedHTTPS(p.hostname, ip, port) if p.scheme == 'https' else http.client.HTTPConnection(ip, port, timeout=30)
        try:
            conn.request('GET', urlunsplit(('', '', p.path or '/', p.query, '')), headers={'Host': p.netloc, 'User-Agent': 'LocalResearchReader/1.0', 'Accept-Encoding': 'identity'})
            response = conn.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader('Location')
                if not location:
                    raise HTTPException(400, 'Redirect has no location')
                url = urljoin(url, location)
                continue
            if response.status != 200:
                raise HTTPException(400, f'Download returned HTTP {response.status}')
            size = response.getheader('Content-Length')
            if size and int(size) > MAX_BYTES:
                raise HTTPException(413, 'PDF exceeds 60 MB limit')
            chunks, total = [], 0
            while chunk := response.read(65536):
                total += len(chunk)
                if total > MAX_BYTES:
                    raise HTTPException(413, 'Download exceeds 60 MB limit')
                chunks.append(chunk)
            data = b''.join(chunks)
            if data.lstrip().startswith(b'%PDF-'):
                return data, url
            if metadata:
                parser = Metadata()
                parser.feed(data.decode('utf-8', errors='replace'))
                if parser.pdf:
                    return download(urljoin(url, parser.pdf), metadata=False)
            raise HTTPException(400, 'URL did not contain a PDF or citation_pdf_url metadata')
        except (OSError, ValueError, http.client.HTTPException):
            raise HTTPException(400, 'Could not download PDF from URL')
        finally:
            conn.close()
    raise HTTPException(400, 'Too many redirects')
