import sys, os, json, threading, http.server, tempfile, stat
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.dirname(__import__('os').path.abspath(__file__)))); sys.dont_write_bytecode = True
import publish
mode = {'v': 200}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        m = mode['v']
        if m == 'access': self.send_response(302); self.send_header('Location', 'https://team.cloudflareaccess.com/cdn-cgi/access/login/x'); self.end_headers()
        elif m == 'other': self.send_response(302); self.send_header('Location', 'https://example.com/'); self.end_headers()
        else: self.send_response(m); self.end_headers(); self.wfile.write(b'hi')
srv = http.server.HTTPServer(('127.0.0.1', 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:%d/' % srv.server_port
publish.site_url = lambda p: base
tmp = tempfile.mkdtemp(); sd = os.path.join(tmp, 'sec'); os.makedirs(sd)
html = os.path.join(tmp, 'd.html'); open(html, 'w').write('<html>one</html>')
logs = []; lg = logs.append
fake = os.path.join(tmp, 'npx'); calls = os.path.join(tmp, 'calls.txt')
def mkfake(rc, extra=''):
    open(fake, 'w').write('#!/bin/sh\necho "$@ TOKEN=$CLOUDFLARE_API_TOKEN ACCT=$CLOUDFLARE_ACCOUNT_ID" >> %s\n%s\nexit %d\n' % (calls, extra, rc)); os.chmod(fake, 0o755)
publish._npx = lambda: fake
res = {}
res['off'] = publish.publish(sd, html, lg)
json.dump({'account': 'a' * 32, 'token': 'SECRETTOKEN123456789012345', 'project': 'proj'}, open(os.path.join(sd, 'phone.json'), 'w'))
mkfake(0)
for m in (200, 403, 'other'):
    mode['v'] = m; res['blocked_%s' % m] = publish.publish(sd, html, lg)
assert not os.path.exists(calls), 'npx ran while unprotected'
mode['v'] = 'access'
res['ok'] = publish.publish(sd, html, lg)
res['unchanged'] = publish.publish(sd, html, lg)
open(html, 'w').write('<html>two</html>'); res['changed'] = publish.publish(sd, html, lg)
mkfake(1, 'echo "boom SECRETTOKEN123456789012345 failed"'); open(html, 'w').write('<html>three</html>')
res['fail'] = publish.publish(sd, html, lg)
publish._npx = lambda: None; res['nonode'] = publish.publish(sd, html, lg)
publish._npx = lambda: fake; mkfake(0); res['retry'] = publish.publish(sd, html, lg)
srv.shutdown(); res['refused'] = publish.publish(sd, html + 'x', lg)
print(res)
print(open(calls).read().splitlines()[0])
print(open(os.path.join(sd, 'phone_site', '_headers')).read())
print('token in logs:', any('SECRETTOKEN' in l for l in logs))
print('\n'.join(logs)); print(publish.describe(sd))
