import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import List, Dict, Any


def build_html_email(
    jobs: List[Dict[str, Any]],
    search_title: str,
    freshers_only: bool = False,
    min_stars: int = 1,
) -> str:
    stars_map = {1: "#DC2626", 2: "#EA580C", 3: "#D97706", 4: "#16A34A", 5: "#059669"}

    def rating_badge(rating: int) -> str:
        color = stars_map.get(rating, "#D97706")
        stars = "★" * rating + "☆" * (5 - rating)
        return (
            f'<span style="display:inline-block;background:#FFFBEB;color:{color};'
            f'font-family:\'Courier New\',Courier,monospace;font-size:13px;font-weight:700;'
            f'padding:2px 8px;border:1.5px solid #121214;border-radius:4px;'
            f'box-shadow:1.5px 1.5px 0px #121214;letter-spacing:1px;">{stars} ({rating}/5)</span>'
        )

    def pill(text: str, bg: str = "#FAFAFA", color: str = "#121214", border: str = "#121214") -> str:
        return (
            f'<span style="display:inline-block;background:{bg};color:{color};'
            f'font-family:\'Courier New\',Courier,monospace;font-size:11px;font-weight:700;'
            f'padding:3px 8px;border:1.5px solid {border};border-radius:4px;'
            f'box-shadow:1.5px 1.5px 0px #121214;margin:3px 4px 3px 0;letter-spacing:0.3px;">{text}</span>'
        )

    job_cards = ""
    for idx, job in enumerate(jobs, start=1):
        company = str(job.get("company") or "Unknown").upper()
        title   = str(job.get("title")   or "Role")
        url     = str(job.get("url")     or "#")
        loc     = str(job.get("location") or "India")
        exp     = str(job.get("experience") or "Not Specified")
        sal     = str(job.get("salary")   or "Not Disclosed")
        src     = str(job.get("source")   or "Unknown")
        rating  = int(job.get("rating")   or 3)

        job_cards += f"""
        <!-- JOB CARD {idx} -->
        <tr>
          <td style="padding:10px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="
              background:#FFFFFF;border-radius:6px;border:2px solid #121214;
              box-shadow:4px 4px 0px #121214;overflow:hidden;">
              <tr>
                <td style="background:#FAFAFA;border-bottom:1.5px solid #121214;padding:8px 16px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td align="left">
                        <span style="font-family:\'Courier New\',Courier,monospace;font-size:11px;font-weight:800;
                          color:#121214;text-transform:uppercase;letter-spacing:1px;">
                          MATCH #{idx:02d} // {company}
                        </span>
                      </td>
                      <td align="right">
                        {rating_badge(rating)}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:18px 20px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td>
                        <h2 style="margin:0 0 10px;font-family:\'Courier New\',Courier,monospace;font-size:17px;font-weight:800;
                          color:#121214;line-height:1.35;letter-spacing:-0.2px;">
                          {title}
                        </h2>
                        <div style="margin:10px 0 16px;">
                          {pill("📍 " + loc, "#FFFFFF")}
                          {pill("🕐 " + exp, "#FFFFFF")}
                          {pill("💰 " + sal, "#FEF9C3")}
                          {pill("🔗 " + src, "#E0F2FE", "#0369A1", "#0284C7")}
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding-top:6px;">
                        <a href="{url}" target="_blank"
                          style="display:inline-block;background:#FFE600;color:#121214;
                          font-family:\'Courier New\',Courier,monospace;font-size:12px;font-weight:800;
                          padding:9px 20px;border-radius:4px;border:2px solid #121214;
                          box-shadow:3px 3px 0px #121214;text-decoration:none;letter-spacing:0.5px;
                          text-transform:uppercase;">
                          APPLY_NOW →
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>"""

    filter_badges = ""
    if freshers_only:
        filter_badges += '<span style="display:inline-block;background:#DBEAFE;color:#1E40AF;font-family:\'Courier New\',Courier,monospace;font-size:11px;font-weight:800;padding:4px 10px;border:1.5px solid #121214;border-radius:4px;box-shadow:2px 2px 0px #121214;margin-right:6px;margin-bottom:6px;letter-spacing:0.5px;">🎓 FRESHERS ONLY</span>'
    if min_stars > 1:
        filter_badges += f'<span style="display:inline-block;background:#FEF08A;color:#854D0E;font-family:\'Courier New\',Courier,monospace;font-size:11px;font-weight:800;padding:4px 10px;border:1.5px solid #121214;border-radius:4px;box-shadow:2px 2px 0px #121214;margin-bottom:6px;letter-spacing:0.5px;">⭐ {min_stars}+ STARS</span>'

    count = len(jobs)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Xphire · {search_title} Jobs</title>
</head>
<body style="margin:0;padding:0;background:#F4F4F5;font-family:\'Courier New\',Courier,monospace,sans-serif;-webkit-font-smoothing:antialiased;">
  <!-- OUTER WRAPPER (Paper dot aesthetic) -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F5;padding:32px 12px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- SKETCH HEADER (Matching Website Navbar) -->
          <tr>
            <td style="padding:0 0 20px;">
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:#FFFFFF;border:2.5px solid #121214;border-radius:6px;
                box-shadow:4px 4px 0px #121214;">
                <tr>
                  <td style="padding:14px 18px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <!-- Left Logo Box -->
                        <td width="40" valign="middle">
                          <table width="36" height="36" cellpadding="0" cellspacing="0"
                            style="background:#FAFAFA;border:2px solid #121214;border-radius:4px;
                            box-shadow:2px 2px 0px #121214;text-align:center;">
                            <tr>
                              <td align="center" valign="middle" style="font-family:\'Courier New\',Courier,monospace;font-size:18px;font-weight:900;color:#121214;line-height:1;">
                                ⚡
                              </td>
                            </tr>
                          </table>
                        </td>

                        <!-- Center Status -->
                        <td align="center" valign="middle" style="padding:0 10px;">
                          <span style="font-family:\'Courier New\',Courier,monospace;font-size:18px;font-weight:900;
                            color:#121214;letter-spacing:0.5px;text-transform:uppercase;">
                            SYSTEM ONLINE
                          </span>
                          <span style="display:inline-block;width:10px;height:10px;background:#00E676;
                            border:1.5px solid #121214;border-radius:50%;margin-left:6px;vertical-align:middle;">
                          </span>
                        </td>

                        <!-- Right PFP Box -->
                        <td width="40" align="right" valign="middle">
                          <table width="36" height="36" cellpadding="0" cellspacing="0"
                            style="background:#FAFAFA;border:2px solid #121214;border-radius:4px;
                            box-shadow:2px 2px 0px #121214;text-align:center;">
                            <tr>
                              <td align="center" valign="middle" style="font-family:\'Courier New\',Courier,monospace;font-size:11px;font-weight:800;color:#121214;line-height:1;">
                                AI
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- TERMINAL COMMAND / SEARCH BANNER -->
          <tr>
            <td style="padding:0 0 18px;">
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:#FFFFFF;border:2.5px solid #121214;border-radius:6px;
                box-shadow:4px 4px 0px #121214;overflow:hidden;">
                <!-- Mustard Top Bar -->
                <tr>
                  <td style="background:#D4AC0D;border-bottom:2px solid #121214;padding:10px 18px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-family:\'Courier New\',Courier,monospace;font-size:14px;font-weight:900;
                          color:#121214;letter-spacing:0.5px;">
                          &gt; TERMINAL_DISPATCH :: {search_title.upper()}
                        </td>
                        <td align="right" style="font-family:\'Courier New\',Courier,monospace;font-size:11px;font-weight:800;
                          color:#121214;">
                          [ {count} RESULTS ]
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <!-- Terminal Command Content -->
                <tr>
                  <td style="padding:18px 20px;background:#FFFFFF;">
                    <p style="margin:0 0 6px;font-family:\'Courier New\',Courier,monospace;font-size:12px;font-weight:700;color:#52525B;">
                      <span style="color:#059669;font-weight:800;">$</span> xphire scout --role &quot;<strong style="color:#121214;">{search_title}</strong>&quot; --output email
                    </p>
                    <p style="margin:0 0 12px;font-family:\'Courier New\',Courier,monospace;font-size:12px;font-weight:700;color:#52525B;">
                      <span style="color:#0284C7;font-weight:800;">&gt;&gt;</span> Discovered {count} fresh role{"s" if count != 1 else ""} across 850+ ATS boards &amp; job portals.
                    </p>
                    {f'<div style="margin:4px 0 0;">{filter_badges}</div>' if filter_badges else ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- SECTION DIVIDER -->
          <tr>
            <td style="padding:6px 0 10px;text-align:center;">
              <span style="font-family:\'Courier New\',Courier,monospace;font-size:11px;font-weight:800;color:#71717A;letter-spacing:2px;">
                ══════ DISPATCHED ROLES ══════
              </span>
            </td>
          </tr>

          <!-- JOB CARDS LIST -->
          {job_cards}

          <!-- FOOTER (Sketch Wireframe Ending) -->
          <tr>
            <td style="padding:22px 0 10px;">
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:#FFFFFF;border:2px solid #121214;border-radius:6px;
                box-shadow:3px 3px 0px #121214;overflow:hidden;">
                <tr>
                  <td style="padding:16px 20px;text-align:center;">
                    <p style="margin:0 0 4px;font-family:\'Courier New\',Courier,monospace;font-size:12px;font-weight:800;color:#121214;">
                      [ XPHIRE AI · JOB SCOUT TERMINAL ]
                    </p>
                    <p style="margin:0 0 6px;font-family:\'Courier New\',Courier,monospace;font-size:11px;color:#71717A;">
                      Scraped via LinkedIn, Indeed, Google Jobs &amp; 850+ ATS Endpoints
                    </p>
                    <p style="margin:0;font-family:\'Courier New\',Courier,monospace;font-size:10px;color:#A1A1AA;">
                      ⚡ System Online · Transmitted automatically for your active workflow
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def send_email(html: str, subject: str, recipient: str) -> None:
    host     = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    port     = int(os.environ.get("SMTP_PORT", "465"))
    user     = os.environ.get("SMTP_USER", "")
    password = os.environ.get("SMTP_PASSWORD", "")

    if not user or not password:
        print("[EMAIL] SMTP_USER or SMTP_PASSWORD not set - skipping send.")
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"Xphire AI <{user}>"
    msg["To"]      = recipient
    msg.attach(MIMEText(html, "html", "utf-8"))

    max_retries = 3
    for attempt in range(1, max_retries + 1):
        try:
            # Prefer SMTP_SSL (port 465) - establishes TLS immediately and is
            # more reliable on GitHub Actions hosted runners than STARTTLS.
            if port == 465:
                with smtplib.SMTP_SSL(host, port) as server:
                    server.login(user, password)
                    server.sendmail(user, recipient, msg.as_string())
            else:
                with smtplib.SMTP(host, port) as server:
                    server.ehlo()
                    server.starttls()
                    server.ehlo()
                    server.login(user, password)
                    server.sendmail(user, recipient, msg.as_string())

            print(f"[EMAIL] Sent to {recipient} ✓")
            return
        except (smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError, OSError) as exc:
            print(f"[EMAIL] Attempt {attempt}/{max_retries} failed: {exc}")
            if attempt < max_retries:
                import time
                time.sleep(2 * attempt)  # exponential-ish back-off
            else:
                raise
