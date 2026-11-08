"""Run the local VMMS -> Keycloak -> VMMS authorization-code flow with a synthetic account."""
from __future__ import annotations

from http.cookiejar import CookieJar
from html.parser import HTMLParser
import json
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlparse
from urllib.request import BaseHandler, HTTPCookieProcessor, Request, build_opener


ROOT = Path(__file__).resolve().parents[1]
VMMS_ORIGIN = "http://127.0.0.1:5173"
API_ORIGIN = "http://127.0.0.1:4100"
START_URL = f"{API_ORIGIN}/api/v1/auth/oidc/start"


def read_env() -> dict[str, str]:
    values: dict[str, str] = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    return values


class LoginFormParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.forms: list[dict[str, object]] = []
        self.current: dict[str, object] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "form":
            self.current = {"action": values.get("action", ""), "fields": {}}
        elif tag == "input" and self.current is not None:
            name = values.get("name")
            if name:
                fields = self.current["fields"]
                if isinstance(fields, dict):
                    fields[name] = values.get("value", "") or ""

    def handle_endtag(self, tag: str) -> None:
        if tag == "form" and self.current is not None:
            self.forms.append(self.current)
            self.current = None


class CookieNameProbe(BaseHandler):
    handler_order=999

    def __init__(self) -> None:
        self.login_post_cookie_names: list[str] = []

    def http_request(self, request: Request) -> Request:
        if "/login-actions/" in request.full_url:
            header=request.get_header("Cookie") or request.unredirected_hdrs.get("Cookie","")
            self.login_post_cookie_names=[pair.split("=",1)[0].strip() for pair in header.split(";") if "=" in pair]
        return request

    https_request=http_request


def main() -> None:
    env = read_env()
    username = env.get("OIDC_DEV_TEST_USERNAME", "vmms.advisor.local")
    password = env.get("OIDC_DEV_TEST_PASSWORD", "")
    if not password:
        raise SystemExit("Synthetic local OIDC test account is not provisioned.")

    cookie_jar=CookieJar()
    cookie_probe=CookieNameProbe()
    opener = build_opener(HTTPCookieProcessor(cookie_jar),cookie_probe)
    stage="start"
    login_page_url=""
    action=""
    try:
        with opener.open(START_URL, timeout=15) as response:
            login_page = response.read().decode("utf-8", errors="replace")
            login_page_url = response.geturl()
        stage="login_form"
        parser = LoginFormParser()
        parser.feed(login_page)
        selected = next(
            (
                form
                for form in parser.forms
                if isinstance(form.get("fields"), dict)
                and "username" in form["fields"]
                and "password" in form["fields"]
            ),
            None,
        )
        if selected is None:
            raise RuntimeError
        fields = selected["fields"]
        if not isinstance(fields, dict):
            raise RuntimeError
        fields.update({"username": username, "password": password})
        action = urljoin(login_page_url, str(selected["action"]))
        request = Request(action, data=urlencode(fields).encode(), headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
        action_host=urlparse(action).hostname
        provider_cookies=[cookie for cookie in cookie_jar if action_host in {cookie.domain,cookie.domain.lstrip("."),"localhost" if cookie.domain=="localhost.local" else cookie.domain} and urlparse(action).path.startswith(cookie.path)]
        if provider_cookies:
            request.add_unredirected_header("Cookie","; ".join(f"{cookie.name}={cookie.value}" for cookie in provider_cookies))
        stage="credential_post"
        with opener.open(request, timeout=30) as response:
            if response.status != 200 or not response.geturl().startswith(VMMS_ORIGIN):
                raise RuntimeError
            response.read()
        stage="session_check"
        with opener.open(f"{API_ORIGIN}/api/v1/session", timeout=15) as response:
            session = json.load(response)
    except (HTTPError, URLError, TimeoutError, RuntimeError, json.JSONDecodeError):
        cookies=[{"domain":cookie.domain,"name":cookie.name,"path":cookie.path} for cookie in cookie_jar]
        action_url=urljoin(login_page_url,action) if action else ""
        action_parts=urlparse(action_url)
        print(json.dumps({"failed_stage":stage,"provider_cookies":cookies,"login_post":{"host":action_parts.hostname,"path":action_parts.path,"cookie_names":cookie_probe.login_post_cookie_names}}))
        raise SystemExit("The local OIDC browser flow failed. No cookies or credentials were printed.") from None

    if not session.get("authenticated") or not session.get("sites"):
        raise SystemExit("The provider flow returned without an approved VMMS staff session.")
    print(json.dumps({"provider":"local Keycloak","browser_redirect_chain":"passed","vmms_session":"authenticated","site_count":len(session["sites"])}))


if __name__ == "__main__":
    main()
