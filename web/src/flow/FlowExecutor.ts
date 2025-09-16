import "#elements/LoadingOverlay";
import "#elements/ak-locale-context/ak-locale-context";
import "#flow/components/ak-brand-footer";
import "#flow/components/ak-flow-card";
import "#flow/sources/apple/AppleLoginInit";
import "#flow/sources/plex/PlexLoginInit";
import "#flow/stages/FlowErrorStage";
import "#flow/stages/FlowFrameStage";
import "#flow/stages/RedirectStage";

import { DEFAULT_CONFIG } from "#common/api/config";
import { EVENT_FLOW_ADVANCE, EVENT_FLOW_INSPECTOR_TOGGLE } from "#common/constants";
import { pluckErrorDetail } from "#common/errors/network";
import { globalAK } from "#common/global";
import { configureSentry } from "#common/sentry/index";
import { WebsocketClient } from "#common/ws";

import { Interface } from "#elements/Interface";
import { WithBrandConfig } from "#elements/mixins/branding";
import { WithCapabilitiesConfig } from "#elements/mixins/capabilities";
import { themeImage } from "#elements/utils/images";

import { StageHost, SubmitOptions } from "#flow/stages/base";

import {
  CapabilitiesEnum,
  ChallengeTypes,
  ContextualFlowInfo,
  FlowChallengeResponseRequest,
  FlowErrorChallenge,
  FlowLayoutEnum,
  FlowsApi,
  ShellChallenge,
} from "@goauthentik/api";

import { msg } from "@lit/localize";
import { css, CSSResult, html, nothing, PropertyValues, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { until } from "lit/directives/until.js";

import PFBase from "@patternfly/patternfly/patternfly-base.css";

@customElement("ak-flow-executor")
export class FlowExecutor
  extends WithCapabilitiesConfig(WithBrandConfig(Interface))
  implements StageHost
{
  // === Styles =================================================================
  static styles: CSSResult[] = [
    PFBase,
    css`
      :host {
        --opus-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans";
        --field-radius: 12px;
        --field-border: #eceef1;        /* default border */
        --field-focus: #d1d5db;         /* focus border (light gray) */
        --focus-ring: rgba(209,213,219,.55);
        --error: #ef4444;
        --label: #374151;
        --text: #0b0b0b;
        font-family: var(--opus-font);
        display: block;
        min-height: 100vh;
        background: #fff;
      }

      :root { --opus-login-video: /assets/images/login-video.mp4; }

      /* ===== 50/50 split (always equal columns) ===== */
      .layout {
        display: grid;
        grid-template-columns: 1fr 1fr; /* 50/50 */
        min-height: 100vh;
      }

      /* LEFT — form column */
      .left {
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 72px 64px;
      }

      /* Top-left logo */
      .brand img {
        height: 64px;
        width: auto;
        margin-bottom: 32px;
      }

      /* Center the left half vertically + horizontally */
.left {
  display: flex;
  flex-direction: column;
  justify-content: center;   /* vertical center */
  align-items: center;       /* horizontal center */
  padding: 72px 64px;
}

/* Make the inner shell match: flex w-full max-w-[458px] flex-col items-stretch */
.left .form-shell,
.pf-c-login__main-body,
.pf-c-login__main-header,
.pf-c-login__footer {
  width: 100%;
  max-width: 458px;          /* <- match your legacy container */
  display: flex;
  flex-direction: column;
  align-items: stretch;      /* items-stretch */
  box-sizing: border-box;
}

/* Keep the brand/logo and headings aligned to the same column width */
.left .brand,
.left .helper {
  width: 100%;
  max-width: 458px;
  box-sizing: border-box;
  margin-left: 0;            /* ensure no odd offsets */
  margin-right: 0;
}

/* Optional: tiny gap to breathe between sections */
.left .brand { margin-bottom: 24px; }
.left .form-shell { gap: 16px; }

/* Mobile: preserve stacking and comfortable padding */
@media (max-width: 960px) {
  .left { align-items: stretch; padding: 32px 20px; }
  .left .form-shell,
  .left .brand,
  .left .helper,
  .pf-c-login__footer { max-width: 100%; }
}

      /* Headline + helper matches target */
      h1 {
        font-size: 52px;
        font-weight: 400;
        line-height: 1.05;
        letter-spacing: -0.02em;
        margin: 8px 0 6px;
        color: var(--text);
      }
      .helper {
        font-size: 15px;
        color: #4b5563;
        margin: 6px 0 24px;
      }

      /* Constrain stage content */
      .form-shell {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      /* Labels */
      .form-shell .pf-c-form__label,
      .form-shell .pf-c-form__label-text,
      .form-shell label {
        font-size: 14px;
        color: var(--label);
        margin-bottom: 6px;
        font-weight: 400;
      }

      /* Group spacing */
      .form-shell .pf-c-form__group { margin-bottom: 16px; }

      /* Inputs (PF + native) */
      .form-shell input,
      .form-shell .pf-c-form-control,
      .form-shell input[type="password"] {
        height: 44px;
        border-radius: var(--field-radius);
        border: 1px solid var(--field-border);
        background: #fff;
        padding: 0 14px;
        font-size: 14px;
        box-sizing: border-box;
        box-shadow: 0 1px 0 rgba(0,0,0,.03) inset;
        transition: box-shadow .15s ease, border-color .15s ease;
      }
      /* Placeholder tone */
      .form-shell input::placeholder,
      .form-shell .pf-c-form-control::placeholder { color: #9ca3af; }

      /* Focus (light grey ring slightly thicker) */
      .form-shell input:focus,
      .form-shell .pf-c-form-control:focus {
        outline: none;
        border-color: var(--field-focus);
        box-shadow: 0 0 0 3px var(--focus-ring);
      }

      /* Error state (PF marks group or control with pf-m-error) */
      .form-shell .pf-m-error .pf-c-form-control,
      .form-shell input[aria-invalid="true"],
      .form-shell .pf-c-form-control.pf-m-error {
        border-color: var(--error) !important;
        box-shadow: 0 0 0 3px rgba(239,68,68,.15) !important;
      }
      .form-shell .pf-c-form__helper-text.pf-m-error,
      .form-shell .pf-c-form__helper-text.pf-m-warning {
        color: var(--error);
        font-size: 12px;
        margin-top: 6px;
      }

      /* Primary button: thin weight, chevron, not full-width */
      .form-shell .pf-c-button.pf-m-primary,
      .form-shell button[type="submit"] {
        height: 94px !important;
        border-radius: 12px;
        background: #111111 !important;
        color: #fff !important;
        border: none !important;
        font-weight: 400;
        padding: 0 18px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        width: auto;                 /* defeat pf-m-block default */
      }
 
      .form-shell .pf-c-button.pf-m-primary:hover,
      .form-shell button[type="submit"]:hover { filter: brightness(.93); }

      /* Move mid-body Sign up out of the way; keep footer clean */
      .form-shell a[href*="signup"],
      .form-shell a[href*="enroll"] { display: none !important; }

      /* Footer text (bottom of left column) */
      .footer {
        margin-top: 16px;
        font-size: 14px;
        color: #6b7280;
        max-width: 456px;
      }

      /* RIGHT — media column (keeps your video + rounded artwork look) */
      .right {
        position: relative;
        border-radius: 18px;
        margin: 24px;
        overflow: hidden;
        background: var(--ak-flow-background) center / cover no-repeat; /* fallback */
      }
      .right video {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
        pointer-events: none;
      }

      /* Mobile: stack, hide video panel */
      @media (max-width: 960px) {
        .layout { grid-template-columns: 1fr; }
        .right { display: none; }
        .left { padding: 32px 20px; }
        h1 { font-size: 36px; }
      }

       /* Layout wrapper so the topbar can sit above it cleanly */
    .layout { position: relative; }

    /* Top-left “navbar” brand */
    .topbar {
      position: fixed;        /* floats above both columns */
      top: 24px;
      left: 24px;
      z-index: 20;
      pointer-events: none;   /* let clicks fall through unless on the button */
    }

    .topbar .logo-btn {
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 64px;            /* “size-16” feel */
      height: 64px;
      border-radius: 12px;    /* rounded-sm feel */
      border: 1px solid #e7e7ea;     /* action-secondary border vibe */
      background: #f7f7f9;           /* action-secondary background */
      transition: background 120ms, border-color 120ms;
    }
    .topbar .logo-btn:hover {
      background: #f0f1f3;
      border-color: #d9dae0;
    }
    .topbar .logo-btn:focus-visible {
      outline: 2px solid #1f6feb;    /* subtle focus ring */
      outline-offset: 2px;
    }

    .topbar .logo-img {
      height: 24px;
      width: auto;
    }

    /* Keep mobile spacing pleasant */
    @media (max-width: 960px) {
      .topbar { top: 16px; left: 16px; }
    }
  
    `,
  ];

  // === Properties ==============================================================
  @property() public flowSlug: string = window.location.pathname.split("/")[3];
  #challenge?: ChallengeTypes;

  @property({ attribute: false })
  public set challenge(value: ChallengeTypes | undefined) {
    this.#challenge = value;
    if (value?.flowInfo?.title) {
      document.title = `${value.flowInfo?.title} - ${this.brandingTitle}`;
    } else {
      document.title = this.brandingTitle;
    }
    this.requestUpdate();
  }
  public get challenge(): ChallengeTypes | undefined {
    return this.#challenge;
  }

  @property({ type: Boolean }) public loading = false;

  @state() protected inspectorOpen?: boolean;
  @state() protected inspectorAvailable?: boolean;
  @state() public flowInfo?: ContextualFlowInfo;

  // === Lifecycle ===============================================================
  constructor() {
    // configureSentry();
    super();
    WebsocketClient.connect();

    const inspector = new URL(window.location.toString()).searchParams.get("inspector");
    if (inspector === "" || inspector === "open") {
      this.inspectorOpen = true;
      this.inspectorAvailable = true;
    } else if (inspector === "available") {
      this.inspectorAvailable = true;
    }

    this.addEventListener(EVENT_FLOW_INSPECTOR_TOGGLE, () => {
      this.inspectorOpen = !this.inspectorOpen;
    });
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    WebsocketClient.close();
  }

  public async firstUpdated(): Promise<void> {
    if (this.can(CapabilitiesEnum.CanDebug)) this.inspectorAvailable = true;

    this.loading = true;

    return new FlowsApi(DEFAULT_CONFIG)
      .flowsExecutorGet({
        flowSlug: this.flowSlug,
        query: window.location.search.substring(1),
      })
      .then((challenge: ChallengeTypes) => {
        if (this.inspectorOpen) {
          window.dispatchEvent(
            new CustomEvent(EVENT_FLOW_ADVANCE, { bubbles: true, composed: true }),
          );
        }
        this.challenge = challenge;
        if (this.challenge.flowInfo) this.flowInfo = this.challenge.flowInfo;
      })
      .catch((error) => {
        const challenge: FlowErrorChallenge = {
          component: "ak-stage-flow-error",
          error: pluckErrorDetail(error),
          requestId: "",
        };
        this.challenge = challenge as ChallengeTypes;
      })
      .finally(() => {
        this.loading = false;
      });
  }

  // Keep background in sync with Flow info (image fallback)
  public updated(changed: PropertyValues<this>) {
    if (changed.has("flowInfo") && this.flowInfo) {
      this.style.setProperty("--ak-flow-background", `url('${this.flowInfo.background}')`);
    }
  }

  // === StageHost ===============================================================
  public submit = async (
    payload?: FlowChallengeResponseRequest,
    options?: SubmitOptions,
  ): Promise<boolean> => {
    if (!payload) throw new Error("No payload provided");
    if (!this.challenge) throw new Error("No challenge provided");

    payload.component = this.challenge.component as FlowChallengeResponseRequest["component"];
    if (!options?.invisible) this.loading = true;

    return new FlowsApi(DEFAULT_CONFIG)
      .flowsExecutorSolve({
        flowSlug: this.flowSlug,
        query: window.location.search.substring(1),
        flowChallengeResponseRequest: payload,
      })
      .then((challenge) => {
        if (this.inspectorOpen) {
          window.dispatchEvent(
            new CustomEvent(EVENT_FLOW_ADVANCE, { bubbles: true, composed: true }),
          );
        }
        this.challenge = challenge;
        if (this.challenge.flowInfo) this.flowInfo = this.challenge.flowInfo;
        return !this.challenge.responseErrors;
      })
      .catch((error: unknown) => {
        const challenge: FlowErrorChallenge = {
          component: "ak-stage-flow-error",
          error: pluckErrorDetail(error),
          requestId: "",
        };
        this.challenge = challenge as ChallengeTypes;
        return false;
      })
      .finally(() => {
        this.loading = false;
      });
  };

  // === Helpers =================================================================
  private getVideoUrl(): string | undefined {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="opus-login-video"]');
    if (meta?.content) return meta.content.trim();
    const varVal = getComputedStyle(document.documentElement)
      .getPropertyValue("--opus-login-video")
      .trim();
    return varVal || undefined;
  }

  // === Rendering ===============================================================
  getLayout(): string {
    const prefilledFlow = globalAK()?.flow?.layout || FlowLayoutEnum.Stacked;
    if (this.challenge) return this.challenge?.flowInfo?.layout || prefilledFlow;
    return prefilledFlow;
  }
  getLayoutClass(): string {
    const layout = this.getLayout();
    switch (layout) {
      case FlowLayoutEnum.ContentLeft:
        return "pf-c-login__container";
      case FlowLayoutEnum.ContentRight:
        return "pf-c-login__container content-right";
      case FlowLayoutEnum.Stacked:
      default:
        return "ak-login-container";
    }
  }

  async renderChallenge(): Promise<TemplateResult> {
    if (!this.challenge) return html`<ak-flow-card loading></ak-flow-card>`;

    switch (this.challenge?.component) {
      case "ak-stage-identification":
        await import("#flow/stages/identification/IdentificationStage");
        return html`<div class="form-shell">
          <ak-stage-identification .host=${this as StageHost} .challenge=${this.challenge}></ak-stage-identification>
        </div>`;
      case "ak-stage-user-login":
        await import("#flow/stages/user_login/UserLoginStage");
        return html`<div class="form-shell">
          <ak-stage-user-login .host=${this as StageHost} .challenge=${this.challenge}></ak-stage-user-login>
        </div>`;
      case "ak-stage-password":
        await import("#flow/stages/password/PasswordStage");
        return html`<div class="form-shell">
          <ak-stage-password .host=${this as StageHost} .challenge=${this.challenge}></ak-stage-password>
        </div>`;
      case "ak-stage-captcha":
        await import("#flow/stages/captcha/CaptchaStage");
        return html`<ak-stage-captcha .host=${this as StageHost} .challenge=${this.challenge}></ak-stage-captcha>`;
      case "ak-stage-consent":
        await import("#flow/stages/consent/ConsentStage");
        return html`<ak-stage-consent .host=${this as StageHost} .challenge=${this.challenge}></ak-stage-consent>`;
      case "ak-stage-authenticator-validate":
        await import("#flow/stages/authenticator_validate/AuthenticatorValidateStage");
        return html`<ak-stage-authenticator-validate .host=${this as StageHost} .challenge=${this.challenge}></ak-stage-authenticator-validate>`;
      case "ak-stage-flow-error":
        return html`<ak-stage-flow-error .host=${this as StageHost} .challenge=${this.challenge}></ak-stage-flow-error>`;
      case "xak-flow-redirect":
        return html`<ak-stage-redirect .host=${this as StageHost} .challenge=${this.challenge} ?promptUser=${this.inspectorOpen}></ak-stage-redirect>`;
      case "xak-flow-shell":
        return html`${unsafeHTML((this.challenge as ShellChallenge).body)}`;
      case "xak-flow-frame":
        return html`<xak-flow-frame .host=${this as StageHost} .challenge=${this.challenge}></xak-flow-frame>`;
      default:
        return html`<ak-flow-card .host=${this as StageHost} .challenge=${this.challenge}></ak-flow-card>`;
    }
  }

 render(): TemplateResult {
  return html`
    <ak-locale-context>
      <!-- Top-left brand (outside .left) -->
      <div class="topbar">
        
          <img
            
            src="http://localhost:9000/static/dist/assets/images/icon_opus.svg"
            alt="Opus Identity Logo"
          />
        
      </div>

      <div class="layout">
        <!-- LEFT: form -->
        <div class="left">
          ${this.loading && this.challenge ? html`<ak-loading-overlay></ak-loading-overlay>` : nothing}

          <!-- Removed the old .brand block so logo isn't inside .left -->

          ${until(this.renderChallenge())}

          <div class="footer">
            <ak-brand-links .links=${this.brandingFooterLinks}></ak-brand-links>
          </div>
        </div>

        <!-- RIGHT: media -->
        <div class="right">
          <video autoplay muted loop playsinline>
            <source src="http://localhost:9000/static/dist/assets/images/login-video.mp4" type="video/mp4" />
          </video>
        </div>
      </div>
    </ak-locale-context>
  `;
}
}

declare global {
  interface HTMLElementTagNameMap {
    "ak-flow-executor": FlowExecutor;
  }
}
