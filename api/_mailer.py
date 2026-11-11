from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
import html
import os
import random
import string
import smtplib
from typing import Any, Dict, Optional

def _get_smtp_host() -> str:
    return (os.getenv("SMTP_HOST") or "smtp.gmail.com").strip()

def _get_smtp_port() -> int:
    raw = (os.getenv("SMTP_PORT") or "465").strip()
    try:
        return int(raw)
    except ValueError:
        return 465

def _get_smtp_user() -> str:
    return (
        os.getenv("SMTP_USER")
        or os.getenv("GMAIL_USER")
        or os.getenv("EMAIL_USER")
        or ""
    ).strip()

def _get_smtp_password() -> str:
    raw = (
        os.getenv("SMTP_PASSWORD")
        or os.getenv("GMAIL_APP_PASSWORD")
        or os.getenv("EMAIL_PASSWORD")
        or ""
    )
    return "".join(raw.split())

def _get_sender_name() -> str:
    return (
        os.getenv("SMTP_FROM_NAME")
        or "Combined Facilities Support Services"
    ).strip()

def _get_sender_email(smtp_user: str = "") -> str:
    explicit = (os.getenv("SMTP_FROM_EMAIL") or "").strip()
    if explicit and smtp_user:
        exp_domain = explicit.split("@")[-1].lower()
        usr_domain = smtp_user.split("@")[-1].lower()
        if exp_domain == usr_domain:
            return explicit
        return smtp_user
    if smtp_user:
        return smtp_user
    return explicit or "donotreply@pigem.ph"

def _get_app_base_url() -> str:
    prod_domain = (os.getenv("VERCEL_PROJECT_PRODUCTION_URL") or "").strip()
    if prod_domain:
        return f"https://{prod_domain}"
    return (os.getenv("APP_BASE_URL") or "https://pigem-system-web.vercel.app").strip().rstrip("/")

def _get_supabase_logo_url() -> str:
    base = (os.getenv("SUPABASE_URL") or "https://wuunqfxyejxwrawtjdrf.supabase.co").strip().rstrip("/")
    return f"{base}/storage/v1/object/public/website-assets/black-logo-white-mode.png"

def _generate_ref_tag(existing_tag: str = "") -> str:

    cleaned = "".join(ch for ch in str(existing_tag or "").upper() if ch.isalpha())

    if len(cleaned) >= 4:

        return cleaned[:4]

    return "".join(random.choices(string.ascii_uppercase, k=4))

def is_configured() -> bool:

    return bool(_get_smtp_user() and _get_smtp_password())

def is_Allowed_customer_gmail(email_addr: str) -> bool:

    cleaned = str(email_addr or "").strip().lower()

    return "@" in cleaned and cleaned.endswith("@gmail.com")

_CONFIDENTIALITY_NOTICE = (
    "Confidentiality Notice: This message from Combined Facilities Support Services (PIGEM) "
    "is intended solely for the recipient named above under the Data Privacy Act of 2012 (RA 10173). "
    "Registered Office: Dasmariñas City, Cavite, Philippines."
)

class BaseEmailTemplateRenderer:
    def __init__(self, sender_name: str):
        self.sender_name = sender_name

    def _escape(self, value: Any) -> str:
        return html.escape(str(value or ""))

    def wrap_layout(
        self,
        title: str,
        subtitle: str,
        body_html: str,
        cta_label: str = "",
        cta_url: str = "",
        ref_tag: str = "",
    ) -> str:
        safe_title = self._escape(title)
        safe_sub = self._escape(subtitle)
        logo_url = _get_supabase_logo_url()
        final_ref_tag = _generate_ref_tag(ref_tag)

        cta_block = ""
        if cta_label and cta_url:
            safe_label = self._escape(cta_label)
            safe_url = self._escape(cta_url)
            cta_block = f"""
            <div style="margin:22px 0;">
              <a href="{safe_url}" target="_blank" rel="noopener"
                 style="display:inline-block;background-color:#c8102e;border:1px solid #c8102e;border-radius:6px;color:#ffffff;text-decoration:none;padding:12px 22px;font-weight:700;font-size:14px;">
                 {safe_label}
              </a>
              <div style="margin-top:10px;font-size:12px;color:#555555;word-break:break-all;">
                Or copy and open this link in your browser:<br>
                <a href="{safe_url}" target="_blank" rel="noopener" style="color:#c8102e;text-decoration:underline;">{safe_url}</a>
              </div>
            </div>
            """

        return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:24px 12px;background-color:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#111111;line-height:1.6;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:28px 26px;">
    <div style="border-bottom:1px solid #e2e8f0;padding-bottom:14px;margin-bottom:20px;">
      <img src="{logo_url}" alt="Combined Facilities Support Services" style="height:40px;width:auto;display:block;margin-bottom:8px;">
      <div style="font-size:12px;font-weight:700;color:#111111;letter-spacing:0.3px;">
        COMBINED FACILITIES SUPPORT SERVICES
      </div>
    </div>

    <div style="font-size:18px;font-weight:700;color:#111111;margin-bottom:4px;">{safe_title}</div>
    <div style="font-size:13px;color:#475569;margin-bottom:18px;">{safe_sub}</div>

    <div style="font-size:14px;color:#111111;">
      {body_html}
    </div>

    {cta_block}

    <div style="margin-top:20px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:12px;color:#475569;">
      <div>Reference Tag: <b>{self._escape(final_ref_tag)}</b></div>
      <p style="margin:8px 0 0;font-size:12px;color:#64748b;">
        This is an automated service email from Combined Facilities Support Services (PIGEM).
        Please do not share your one-time codes with anyone.
      </p>
      <p style="margin:10px 0 0;font-size:11px;color:#64748b;line-height:1.45;">
        {self._escape(_CONFIDENTIALITY_NOTICE)}
      </p>
    </div>
  </div>
</body>
</html>"""

class CustomerEmailRenderer(BaseEmailTemplateRenderer):

    def render(

        self,

        template_type: str,

        subject: str,

        plain_message: str,

        payload: Optional[Dict[str, Any]] = None,

    ) -> str:

        data = payload or {}

        ttype = (template_type or "general").strip().lower()

        app_base = _get_app_base_url().rstrip("/")

        customer_name = self._escape(data.get("customer_name") or "Valued Subscriber")

        ref_no = self._escape(data.get("ref_no") or "")

        plan_name = self._escape(data.get("plan_name") or "Red Fiber Internet Plan")

        ref_tag = _generate_ref_tag(str(data.get("ref_tag") or ""))

        if ttype == "otp":

            otp_code = self._escape(data.get("otp_code") or "")

            purpose_label = self._escape(

                data.get("purpose_label") or "verify your contact details and continue your transaction"

            )

            body = f"""
            <p style="margin:0 0 12px;">Dear <b>{customer_name}</b>,</p>
            <p style="margin:0 0 14px;">
              NEVER SHARE YOUR OTP especially on social media and SMS or email links.
              Your code is for your eyes only.
            </p>
            <p style="margin:0 0 14px;">
              Your OTP to {purpose_label} is:
            </p>
            <div style="border:1px solid #111111;padding:14px 18px;text-align:center;margin:16px 0;">
              <div style="font-size:26px;font-weight:700;letter-spacing:6px;color:#111111;">{otp_code}</div>
            </div>
            <p style="margin:0;font-size:13px;color:#222222;">
              Ref no: <b>{ref_tag}</b>. This code is only valid for 5 minutes upon receiving this email.
            </p>
            """

            return self.wrap_layout(

                title="One-Time Verification Code (OTP)",

                subtitle="Valid for 5 minutes upon receiving this email",

                body_html=body,

                ref_tag=ref_tag,

            )

        if ttype == "activation":
            activation_code = self._escape(data.get("activation_code") or "")
            activation_link = str(
                data.get("activation_link") or f"{app_base}/activate.html"
            )
            portal_link = str(data.get("portal_link") or f"{app_base}/login.html")
            customer_email = self._escape(data.get("customer_email") or "")
            suggested_username = self._escape(data.get("username") or "")
            is_existing = bool(data.get("is_existing_account"))

            if is_existing or not activation_code:
                body = f"""
                <p style="margin:0 0 12px;">Dear <b>{customer_name}</b>,</p>
                <p style="margin:0 0 14px;">
                  Your internet service application has been received and linked to your existing Customer Portal account.
                </p>
                <div style="border:1px solid #cbd5e1;border-radius:6px;padding:14px 16px;margin:14px 0;background:#f8fafc;">
                  <div style="margin-bottom:6px;">Application Reference Number: <b>{ref_no}</b></div>
                  <div style="margin-bottom:6px;">Selected Plan: <b>{plan_name}</b></div>
                  {f'<div style="margin-bottom:6px;">Registered Email: <b>{customer_email}</b></div>' if customer_email else ''}
                  {f'<div>Username: <b>@{suggested_username}</b></div>' if suggested_username else ''}
                </div>
                <p style="margin:0;font-size:13px;color:#334155;">
                  Sign in at the Customer Portal anytime to check your application status.
                </p>
                """
                return self.wrap_layout(
                    title="Application Received - Linked to Your Account",
                    subtitle=f"Application Reference: {ref_no}",
                    body_html=body,
                    cta_label="Open Customer Login Portal",
                    cta_url=portal_link,
                    ref_tag=ref_tag,
                )

            body = f"""
            <p style="margin:0 0 12px;">Dear <b>{customer_name}</b>,</p>
            <p style="margin:0 0 14px;">
              Thank you for applying for Red Fiber Internet service. To view your application progress, please use the
              <b>one-time activation link</b> below to create your Customer Portal password and confirm your username.
            </p>
            <div style="border:1px solid #cbd5e1;border-radius:6px;padding:14px 16px;margin:14px 0;background:#f8fafc;">
              <div style="margin-bottom:6px;">Application Reference Number: <b>{ref_no}</b></div>
              <div style="margin-bottom:6px;">Selected Plan: <b>{plan_name}</b></div>
              {f'<div style="margin-bottom:6px;">Account Email: <b>{customer_email}</b></div>' if customer_email else ''}
              {f'<div style="margin-bottom:6px;">Assigned Username: <b>@{suggested_username}</b></div>' if suggested_username else ''}
              <div>One-Time Activation Code: <b style="letter-spacing:2px;font-size:16px;color:#c8102e;">{activation_code}</b></div>
            </div>
            <p style="margin:0 0 8px;font-size:13px;color:#1e293b;">
              <b>Important:</b> This activation link and code can only be used <b>once</b> to create your account password.
              After activating, use your username or Gmail address to sign in at:
              <a href="{self._escape(portal_link)}" style="color:#c8102e;">{self._escape(portal_link)}</a>
            </p>
            """
            return self.wrap_layout(
                title="Application Received - Create Your Account Password",
                subtitle=f"Application Reference: {ref_no}",
                body_html=body,
                cta_label="Create Password & Activate Account",
                cta_url=activation_link,
                ref_tag=ref_tag,
            )

        if ttype == "correction":

            remarks = self._escape(

                data.get("remarks")

                or "Please sign in to your Customer Portal to review the requested correction and upload an updated requirement."

            )

            portal_link = str(data.get("portal_link") or f"{app_base}/login.html")

            body = f"""
            <p style="margin:0 0 12px;">Dear <b>{customer_name}</b>,</p>
            <p style="margin:0 0 14px;">
              Our verification team reviewed your application (Reference No. <b>{ref_no}</b>) for <b>{plan_name}</b>
              and noted an item that requires a quick update before we can proceed:
            </p>
            <div style="border:1px solid #111111;padding:14px 16px;margin:14px 0;">
              <div style="font-size:12px;font-weight:700;text-transform:uppercase;margin-bottom:6px;">
                Requested Correction / Action Needed
              </div>
              <div style="font-size:14px;">{remarks}</div>
            </div>
            <p style="margin:0;font-size:13px;">
              Please sign in to your Customer Portal to update the requested field or re-upload a clear photo of your Valid ID.
            </p>
            """

            return self.wrap_layout(

                title="Action Needed on Your Application",

                subtitle=f"Application Reference: {ref_no}",

                body_html=body,

                cta_label="Sign In to Customer Portal",

                cta_url=portal_link,

                ref_tag=ref_tag,

            )

        if ttype == "status_update":

            status_label = self._escape(data.get("status_label") or "Updated")

            remarks = self._escape(data.get("remarks") or "")

            installation_date = self._escape(data.get("installation_date") or "")

            portal_link = str(data.get("portal_link") or f"{app_base}/login.html")

            extra_rows = ""

            if installation_date:

                extra_rows += f"<div style='margin-top:6px;'>Target Installation Schedule: <b>{installation_date}</b></div>"

            if remarks:

                extra_rows += f"<div style='margin-top:8px;padding-top:8px;border-top:1px solid #e5e5e5;'>Remarks / Instructions: {remarks}</div>"

            body = f"""
            <p style="margin:0 0 12px;">Dear <b>{customer_name}</b>,</p>
            <p style="margin:0 0 14px;">
              There is a status update regarding your internet service application:
            </p>
            <div style="border:1px solid #d4d4d4;padding:14px 16px;margin:14px 0;">
              <div style="margin-bottom:6px;">Reference Number: <b>{ref_no}</b></div>
              <div style="margin-bottom:6px;">Selected Plan: <b>{plan_name}</b></div>
              <div>Current Status: <b>{status_label}</b></div>
              {extra_rows}
            </div>
            <p style="margin:0;font-size:13px;">
              Sign in to your Customer Portal anytime to view your application timeline.
            </p>
            """

            return self.wrap_layout(

                title=f"Application Update: {status_label}",

                subtitle=f"Application Reference: {ref_no}",

                body_html=body,

                cta_label="View Application Status",

                cta_url=portal_link,

                ref_tag=ref_tag,

            )

        if ttype == "promo":

            promo_title = self._escape(data.get("promo_title") or subject or "Service Announcement")

            promo_body = "<br>".join(

                self._escape(line) for line in (plain_message or "").splitlines()

            )

            body = f"""
            <p style="margin:0 0 12px;">Dear <b>{customer_name}</b>,</p>
            <div style="border:1px solid #d4d4d4;padding:14px 16px;margin:14px 0;">
              <div style="font-size:15px;font-weight:700;margin-bottom:8px;">{promo_title}</div>
              <div style="font-size:14px;">{promo_body}</div>
            </div>
            """

            return self.wrap_layout(

                title=promo_title,

                subtitle="Announcement from PIGEM Support Services",

                body_html=body,

                cta_label="Explore Fiber Plans",

                cta_url=f"{app_base}/index.html#plans",

                ref_tag=ref_tag,

            )

        safe_lines = "<br>".join(

            self._escape(line) for line in (plain_message or "").splitlines()

        )

        body = f"""
        <p style="margin:0 0 12px;">{safe_lines}</p>
        """

        return self.wrap_layout(

            title=subject or "Customer Notification",

            subtitle="PIGEM Support Services",

            body_html=body,

            cta_label="Open Customer Portal",

            cta_url=f"{app_base}/login.html",

            ref_tag=ref_tag,

        )

def send(

    to: str,

    subject: str,

    message: str = "",

    html_content: Optional[str] = None,

    template_type: str = "general",

    payload: Optional[Dict[str, Any]] = None,

) -> Dict[str, Any]:

    recipient = str(to or "").strip().lower()

    if not recipient or "@" not in recipient:

        return {"sent": False, "error": "Invalid recipient email address"}

    if not is_Allowed_customer_gmail(recipient):

        return {

            "sent": False,

            "skipped_non_gmail": True,

            "reason": "External email delivery is reserved for Customer @gmail.com accounts; internal accounts receive in-app dashboard notifications.",

        }

    smtp_user = _get_smtp_user()

    smtp_password = _get_smtp_password()

    if not smtp_user or not smtp_password:

        return {

            "sent": False,

            "error": "Gmail SMTP is not configured. Set SMTP_USER and SMTP_PASSWORD in Vercel Environment Variables.",

        }

    sender_name = _get_sender_name()
    sender_email = _get_sender_email(smtp_user)
    renderer = CustomerEmailRenderer(sender_name=sender_name)

    final_html = html_content
    if not final_html:
        final_html = renderer.render(
            template_type=template_type,
            subject=subject or "PIGEM Notification",
            plain_message=message or "",
            payload=payload,
        )

    payload_dict = payload or {}
    extra_plain = ""
    if payload_dict.get("activation_link") and payload_dict.get("activation_code"):
        extra_plain = (
            f"\nOne-Time Activation Code: {payload_dict.get('activation_code')}\n"
            f"Create your password here (one-time link): {payload_dict.get('activation_link')}\n"
            f"Customer Login Portal: {payload_dict.get('portal_link') or (_get_app_base_url().rstrip('/') + '/login.html')}\n"
        )
    elif payload_dict.get("portal_link"):
        extra_plain = f"\nCustomer Login Portal: {payload_dict.get('portal_link')}\n"

    plain_fallback = (
        f"{(message or subject or 'Please view this message in an HTML-capable email client.').strip()}\n"
        f"{extra_plain}\n"
        "This is an automated service message from Combined Facilities Support Services (PIGEM).\n\n"
        f"{_CONFIDENTIALITY_NOTICE}"
    )

    msg = EmailMessage()
    msg["Subject"] = subject or "PIGEM Notification"
    msg["From"] = formataddr((sender_name, sender_email))
    msg["Reply-To"] = formataddr((sender_name, smtp_user or sender_email))
    msg["To"] = recipient
    msg["Date"] = formatdate(localtime=True)
    domain_part = sender_email.split("@")[-1] if "@" in sender_email else "gmail.com"
    msg["Message-ID"] = make_msgid(domain=domain_part)
    msg.set_content(plain_fallback)
    msg.add_alternative(final_html, subtype="html")

    host = _get_smtp_host()

    port = _get_smtp_port()

    try:

        if port == 465:

            with smtplib.SMTP_SSL(host, port, timeout=15) as server:

                server.login(smtp_user, smtp_password)

                server.send_message(msg, from_addr=smtp_user, to_addrs=[recipient])

        else:

            with smtplib.SMTP(host, port, timeout=15) as server:

                server.ehlo()

                server.starttls()

                server.ehlo()

                server.login(smtp_user, smtp_password)

                server.send_message(msg, from_addr=smtp_user, to_addrs=[recipient])

        return {

            "sent": True,

            "provider": "gmail_smtp",

            "recipient": recipient,

        }

    except Exception as exc:

        return {

            "sent": False,

            "provider": "gmail_smtp",

            "error": str(exc)[:220],

        }
