import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import List, Dict, Any


def build_html_email(jobs: List[Dict[str, Any]], search_title: str) -> str:
    stars_map = {1: "#ef4444", 2: "#f97316", 3: "#eab308", 4: "#22c55e", 5: "#10b981"}

    def rating_badge(rating: int) -> str:
        color = stars_map.get(rating, "#eab308")
        stars = "★" * rating + "☆" * (5 - rating)
        return (
            f'<span style="color:{color};font-size:14px;letter-spacing:1px;">{stars}</span>'
        )

    def pill(text: str, bg: str = "#1e293b", color: str = "#94a3b8") -> str:
        return (
            f'<span style="display:inline-block;background:{bg};color:{color};'
            f'font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;'
            f'margin:2px 3px 2px 0;letter-spacing:0.4px;">{text}</span>'
        )

    job_cards = ""
    for job in jobs:
        company = str(job.get("company") or "Unknown").upper()
        title   = str(job.get("title")   or "Role")
        url     = str(job.get("url")     or "#")
        loc     = str(job.get("location") or "India")
        exp     = str(job.get("experience") or "Not Specified")
        sal     = str(job.get("salary")   or "Not Disclosed")
        src     = str(job.get("source")   or "Unknown")
        rating  = int(job.get("rating")   or 3)

        job_cards += f"""
        <tr>
          <td style="padding:12px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="
              background:#161b22;border-radius:14px;border:1px solid #21262d;
              overflow:hidden;">
              <tr>
                <td style="padding:20px 24px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td>
                        <p style="margin:0 0 2px;font-size:11px;font-weight:700;
                          color:#58a6ff;text-transform:uppercase;letter-spacing:1px;">
                          {company}
                        </p>
                        <h2 style="margin:0 0 8px;font-size:17px;font-weight:700;
                          color:#e6edf3;line-height:1.3;">
                          {title}
                        </h2>
                        <div style="margin-bottom:12px;">
                          {rating_badge(rating)}
                        </div>
                        <div>
                          {pill("📍 " + loc)}
                          {pill("🕐 " + exp)}
                          {pill("💰 " + sal)}
                          {pill("🔗 " + src, "#0d2137", "#58a6ff")}
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding-top:16px;">
                        <a href="{url}" target="_blank"
                          style="display:inline-block;background:linear-gradient(135deg,#238636,#2ea043);
                          color:#ffffff;font-size:13px;font-weight:700;padding:10px 22px;
                          border-radius:8px;text-decoration:none;letter-spacing:0.3px;">
                          Apply Now →
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>"""

    count = len(jobs)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>FreshLab · {search_title} Jobs</title>
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- HEADER -->
          <tr>
            <td style="padding:0 0 28px;">
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:linear-gradient(135deg,#161b22 0%,#0d2137 100%);
                border-radius:16px;border:1px solid #21262d;overflow:hidden;">
                <tr>
                  <td style="padding:32px 32px 28px;">
                    <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#58a6ff;
                      text-transform:uppercase;letter-spacing:2px;">FreshLab AI · Job Scout</p>
                    <h1 style="margin:0 0 10px;font-size:28px;font-weight:800;
                      color:#e6edf3;line-height:1.2;">
                      {search_title}<br/>
                      <span style="color:#58a6ff;">Opportunities</span>
                    </h1>
                    <p style="margin:0;font-size:14px;color:#8b949e;line-height:1.6;">
                      {count} fresh role{"s" if count != 1 else ""} curated and AI-scored just for you.
                      Ratings reflect company quality on a 1–5 scale.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- JOB CARDS -->
          {job_cards}

          <!-- FOOTER -->
          <tr>
            <td style="padding:24px 0 0;">
              <table width="100%" cellpadding="0" cellspacing="0"
                style="border-top:1px solid #21262d;">
                <tr>
                  <td style="padding:24px 0;text-align:center;">
                    <p style="margin:0 0 4px;font-size:12px;color:#8b949e;">
                      Powered by <strong style="color:#58a6ff;">FreshLab AI</strong>
                      · Scraped from LinkedIn, Indeed &amp; Google Jobs
                    </p>
                    <p style="margin:0;font-size:11px;color:#484f58;">
                      You received this because a search was run on your behalf.
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
    port     = int(os.environ.get("SMTP_PORT", "587"))
    user     = os.environ.get("SMTP_USER", "")
    password = os.environ.get("SMTP_PASSWORD", "")

    if not user or not password:
        print("[EMAIL] SMTP_USER or SMTP_PASSWORD not set — skipping send.")
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"FreshLab AI <{user}>"
    msg["To"]      = recipient
    msg.attach(MIMEText(html, "html", "utf-8"))

    with smtplib.SMTP(host, port) as server:
        server.ehlo()
        server.starttls()
        server.login(user, password)
        server.sendmail(user, recipient, msg.as_string())

    print(f"[EMAIL] Sent to {recipient} ✓")
