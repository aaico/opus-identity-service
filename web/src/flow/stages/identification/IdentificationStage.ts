import "#elements/Divider";
import "#elements/EmptyState";
import "#flow/components/ak-flow-card";
import "#flow/components/ak-flow-password-input";
import "#flow/stages/captcha/CaptchaStage";

import { AKFormErrors } from "#components/ak-field-errors";
import { AKLabel } from "#components/ak-label";

import { renderSourceIcon } from "#admin/sources/utils";

import { BaseStage } from "#flow/stages/base";
import { AkRememberMeController } from "#flow/stages/identification/RememberMeController";

import {
    FlowDesignationEnum,
    IdentificationChallenge,
    IdentificationChallengeResponseRequest,
    LoginSource,
    UserFieldsEnum,
} from "@goauthentik/api";

import { msg, str } from "@lit/localize";
import { css, CSSResult, html, nothing, PropertyValues, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";

import PFAlert from "@patternfly/patternfly/components/Alert/alert.css";
import PFButton from "@patternfly/patternfly/components/Button/button.css";
import PFForm from "@patternfly/patternfly/components/Form/form.css";
import PFFormControl from "@patternfly/patternfly/components/FormControl/form-control.css";
import PFInputGroup from "@patternfly/patternfly/components/InputGroup/input-group.css";
import PFLogin from "@patternfly/patternfly/components/Login/login.css";
import PFTitle from "@patternfly/patternfly/components/Title/title.css";
import PFBase from "@patternfly/patternfly/patternfly-base.css";

export const PasswordManagerPrefill: {
    password?: string;
    totp?: string;
} = {};

export const OR_LIST_FORMATTERS: Intl.ListFormat = new Intl.ListFormat("default", {
    style: "short",
    type: "disjunction",
});

@customElement("ak-stage-identification")
export class IdentificationStage extends BaseStage<
    IdentificationChallenge,
    IdentificationChallengeResponseRequest
> {
    static styles: CSSResult[] = [
        PFBase,
        PFAlert,
        PFInputGroup,
        PFLogin,
        PFForm,
        PFFormControl,
        PFTitle,
        PFButton,
        ...AkRememberMeController.styles,
        css`
  .pf-c-form__group.pf-m-action {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between; /* left text | right button */
    gap: 1.75rem;                   /* like tailwind gap-7 / gap-14 feel */
    margin-top: 1rem;
  }

  /* Recovery copy */
  .ak-recovery {
    margin: 0;
    font-size: 14px;
    color: #111827;                 /* near black */
  }
  .ak-recovery a {
    color: #0b0b0b;
    text-decoration: underline;
  }

  /* === Shared input styling (login + reset password) === */
.pf-c-form-control,
input[type="email"],
input[type="text"],
input[type="password"] {
  height: 44px;
  border-radius: 12px;
  border: 1px solid #eceef1;
  background: #ffffff;
  box-shadow: 0 1px 0 rgba(0,0,0,0.03) inset;
  padding: 0 14px;
  font-size: 14px;
  box-sizing: border-box;
  margin-top: 0.5rem;
  transition: box-shadow .15s ease, border-color .15s ease;
}

/* Placeholder tone */
.pf-c-form-control::placeholder,
input::placeholder {
  color: #9ca3af;
}

/* Focus state */
.pf-c-form-control:focus,
input:focus {
  outline: none;
  border-color: #d1d5db;
  box-shadow: 0 0 0 3px rgba(209,213,219,0.55);
}

/* Labels */
      .form-shell .pf-c-form__label,
      .form-shell .pf-c-form__label-text,
      .form-shell label {
        font-size: 16px;
        color: var(--label);
        margin-bottom: 6px;
        font-weight: 400 !important;
      }

      .pf-c-form__label-text.ak-stage-identification {
        font-weight: 400;
        font-size: 16px
      }

  /* Make sure the primary button is content-sized, not full width */
  .pf-c-button.pf-m-primary.pf-m-block { width: auto !important; }

  /* Left column already flex column, just make sure children align */
.left {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;  /* content starts at top */
  min-height: 100vh;            /* take full viewport height */
}

/* Footer pushed to bottom */
.pf-c-login__main-footer-band {
  margin-top: auto;             /* pushes it to bottom */
  padding: 1rem 0;
  font-size: 14px;
  color: #6b7280;
}

  /* Stack on small screens */
  @media (max-width: 640px) {
    .pf-c-form__group.pf-m-action {
      flex-direction: column;
      align-items: flex-start;
      gap: .75rem;
    }
  }
`
    ];

    /**
     * The ID of the input field.
     *
     * @attr
     */
    @property({ type: String, attribute: "input-id" })
    public inputID = "ak-identifier-input";

    #form?: HTMLFormElement;

    #rememberMe = new AkRememberMeController(this);

    //#region State

    @state()
    protected captchaToken = "";

    @state()
    protected captchaRefreshedAt = new Date();

    @state()
    protected captchaLoaded = false;

    #captchaInputRef = createRef<HTMLInputElement>();

    #tokenChangeListener = (token: string) => {
        const input = this.#captchaInputRef.value;

        if (!input) return;

        input.value = token;
    };

    #captchaLoadListener = () => {
        this.captchaLoaded = true;
    };

    //#endregion

    //#region Lifecycle

    public updated(changedProperties: PropertyValues<this>) {
        if (changedProperties.has("challenge") && this.challenge !== undefined) {
            this.#autoRedirect();
            this.#createHelperForm();
        }
    }
    

    //#endregion
    

    #autoRedirect(): void {
        if (!this.challenge) return;
        // We only want to auto-redirect to a source if there's only one source.
        if (this.challenge.sources?.length !== 1) return;

        // And we also only do an auto-redirect if no user fields are select
        // meaning that without the auto-redirect the user would only have the option
        // to manually click on the source button
        if ((this.challenge.userFields || []).length !== 0) return;

        // We also don't want to auto-redirect if there's a passwordless URL configured
        if (this.challenge.passwordlessUrl) return;

        const source = this.challenge.sources[0];
        this.host.challenge = source.challenge;
    }

    //#region Helper Form

    #createHelperForm(): void {
        const compatMode = "ShadyDOM" in window;
        this.#form = document.createElement("form");
        document.documentElement.appendChild(this.#form);
        // Only add the additional username input if we're in a shadow dom
        // otherwise it just confuses browsers
        if (!compatMode) {
            // This is a workaround for the fact that we're in a shadow dom
            // adapted from https://github.com/home-assistant/frontend/issues/3133
            const username = document.createElement("input");
            username.setAttribute("type", "text");
            username.setAttribute("name", "username"); // username as name for high compatibility
            username.setAttribute("autocomplete", "username");
            username.onkeyup = (ev: Event) => {
                const el = ev.target as HTMLInputElement;
                (this.shadowRoot || this)
                    .querySelectorAll<HTMLInputElement>("input[name=uidField]")
                    .forEach((input) => {
                        input.value = el.value;
                        // Because we assume only one input field exists that matches this
                        // call focus so the user can press enter
                        input.focus();
                    });
            };
            this.#form.appendChild(username);
        }
        // Only add the password field when we don't already show a password field
        if (!compatMode && !this.challenge.passwordFields) {
            const password = document.createElement("input");
            password.setAttribute("type", "password");
            password.setAttribute("name", "password");
            password.setAttribute("autocomplete", "current-password");
            password.onkeyup = (event: KeyboardEvent) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    this.submitForm();
                }

                const el = event.target as HTMLInputElement;
                // Because the password field is not actually on this page,
                // and we want to 'prefill' the password for the user,
                // save it globally
                PasswordManagerPrefill.password = el.value;
                // Because password managers fill username, then password,
                // we need to re-focus the uid_field here too
                (this.shadowRoot || this)
                    .querySelectorAll<HTMLInputElement>("input[name=uidField]")
                    .forEach((input) => {
                        // Because we assume only one input field exists that matches this
                        // call focus so the user can press enter
                        input.focus();
                    });
            };

            this.#form.appendChild(password);
        }

        const totp = document.createElement("input");

        totp.setAttribute("type", "text");
        totp.setAttribute("name", "code");
        totp.setAttribute("autocomplete", "one-time-code");
        totp.onkeyup = (event: KeyboardEvent) => {
            if (event.key === "Enter") {
                event.preventDefault();
                this.submitForm();
            }

            const el = event.target as HTMLInputElement;
            // Because the totp field is not actually on this page,
            // and we want to 'prefill' the totp for the user,
            // save it globally
            PasswordManagerPrefill.totp = el.value;
            // Because totp managers fill username, then password, then optionally,
            // we need to re-focus the uid_field here too
            (this.shadowRoot || this)
                .querySelectorAll<HTMLInputElement>("input[name=uidField]")
                .forEach((input) => {
                    // Because we assume only one input field exists that matches this
                    // call focus so the user can press enter
                    input.focus();
                });
        };

        this.#form.appendChild(totp);
    }

    //#endregion

    onSubmitSuccess(): void {
        this.#form?.remove();
    }

    onSubmitFailure(): void {
        this.captchaRefreshedAt = new Date();
    }

    //#region Render

    renderSource(source: LoginSource): TemplateResult {
        const icon = renderSourceIcon(source.name, source.iconUrl);
        return html`<li class="pf-c-login__main-footer-links-item">
            <button
                type="button"
                @click=${() => {
                    if (!this.host) return;
                    this.host.challenge = source.challenge;
                }}
                class=${this.challenge.showSourceLabels ? "pf-c-button pf-m-link" : ""}
            >
                <span class="pf-c-button__icon pf-m-start">${icon}</span>
                ${this.challenge.showSourceLabels ? source.name : ""}
            </button>
        </li>`;
    }

    renderFooter() {
  if (!this.challenge?.enrollUrl && !this.challenge?.recoveryUrl) {
    return nothing;
  }
  return html`
    <div slot="footer-band" class="pf-c-login__main-footer-band">
      ${this.challenge.enrollUrl
        ? html`
            <p class="pf-c-login__main-footer-band-item" data-test-id='sign-up-link'>
              ${msg("Don't have an account?")}
              <a id="enroll" href="${this.challenge.enrollUrl}">
                ${msg("Sign up.")}
              </a>
            </p>
          `
        : nothing}
    </div>
  `;
}

    renderInput(): TemplateResult {
        let type: "text" | "email" = "text";
        if (!this.challenge?.userFields || this.challenge.userFields.length === 0) {
            return html`<p>${msg("Select one of the options below to continue.")}</p>`;
        }
        const fields = (this.challenge?.userFields || []).sort();
        // Check if the field should be *only* email to set the input type
        if (fields.includes(UserFieldsEnum.Email) && fields.length === 1) {
            type = "email";
        }
        const uiFields: { [key: string]: string } = {
            [UserFieldsEnum.Username]: msg("Username"),
            [UserFieldsEnum.Email]: msg("Email"),
            [UserFieldsEnum.Upn]: msg("UPN"),
        };
        const label = OR_LIST_FORMATTERS.format(fields.map((f) => uiFields[f]));

        return html`${this.challenge.flowDesignation === FlowDesignationEnum.Recovery
                ? html`
                      <p>
                          ${msg(
                              "Enter the email associated with your account, and we'll send you a link to reset your password.",
                          )}
                      </p>
                  `
                : nothing}
            <div class="pf-c-form__group">
                ${AKLabel({ required: true, htmlFor: this.inputID }, label)}
                <input
                    id=${this.inputID}
                    type=${type}
                    name="uidField"
                    placeholder=${label}
                    autofocus=""
                    autocomplete="username"
                    spellcheck="false"
                    class="pf-c-form-control"
                    value=${this.#rememberMe?.username ?? ""}
                    data-test-id="email-input"
                    pattern="^[^\s@]+@[^\s@]+\.[^\s@]+$"
                    required
                />
                ${this.#rememberMe.render()}
                ${AKFormErrors({ errors: this.challenge.responseErrors?.uid_field })}
            </div>
            ${this.challenge.passwordFields
                ? html`
                      <ak-flow-input-password
                          label=${msg("Password")}
                          input-id="ak-stage-identification-password"
                          required
                          class="pf-c-form__group"
                          .errors=${this.challenge?.responseErrors?.password}
                          ?allow-show-password=${this.challenge.allowShowPassword}
                          prefill=${PasswordManagerPrefill.password ?? ""}
                          data-test-id="password-input"
                      ></ak-flow-input-password>
                  `
                : nothing}
            ${this.renderNonFieldErrors()}
            ${this.challenge.captchaStage
  ? html`
        <div class="captcha-container">
          <ak-stage-captcha
            .challenge=${this.challenge.captchaStage}
            .onTokenChange=${this.#tokenChangeListener}
            .onLoad=${this.#captchaLoadListener}
            .refreshedAt=${this.captchaRefreshedAt}
            embedded
          >
          </ak-stage-captcha>
          <input
            class="faux-input"
            ${ref(this.#captchaInputRef)}
            name="captchaToken"
            type="text"
            required
            value=""
          />
        </div>
      `
  : nothing}

<!-- Actions row: Forgot password (left) | Login button (right) -->
<div class="pf-c-form__group pf-m-action">
  ${this.challenge.recoveryUrl
    ? html`<p class="ak-recovery">
            
            <a id="recovery" href="${this.challenge.recoveryUrl}" data-test-id='reset-password-link'>
             ${msg("Forgot your password?")}
            </a>
          </p>`
    : html`<span></span>`}
  <button
    ?disabled=${this.challenge.captchaStage && !this.captchaLoaded}
    type="submit"
    class="pf-c-button pf-m-primary"
    data-test-id="login-button"
  >
    ${this.challenge.primaryAction}
    <!-- Chevron -->
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none"
         viewBox="0 0 24 24" role="img" class="h-5 w-5" aria-label="ChevronRight">
      <path fill="currentColor"
            d="M15.44 11.5 5.47 1.53 6.53.47 17.56 11.5 6.53 22.53l-1.06-1.06z" />
    </svg>
  </button>
</div>
            ${this.challenge.passwordlessUrl
                ? html`<ak-divider>${msg("Or")}</ak-divider>`
                : nothing}`;
    }

    render(): TemplateResult {
        return html`<ak-flow-card .challenge=${this.challenge}>
            <form class="pf-c-form" @submit=${(e: Event) => {
    const form = e.currentTarget as HTMLFormElement;
    // Mark form as “submitted at least once”
    form.classList.add('was-submitted');

    // Let the browser run built-in validation:
    if (!form.checkValidity()) {
      // Block submit so the user sees native error UI + our CSS
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Proceed with the normal flow submit
    this.submitForm(e as SubmitEvent);
  }}>
                ${this.challenge.applicationPre
                    ? html`<p>
                          ${msg(str`Login to continue to ${this.challenge.applicationPre}.`)}
                      </p>`
                    : nothing}
                ${this.renderInput()}
                ${this.challenge.passwordlessUrl
                    ? html`
                          <div>
                              <a
                                  href=${this.challenge.passwordlessUrl}
                                  class="pf-c-button pf-m-secondary pf-m-block"
                              >
                                  ${msg("Use a security key")}
                              </a>
                          </div>
                      `
                    : nothing}
            </form>
            ${(this.challenge.sources || []).length > 0
                ? html`<ul slot="footer" class="pf-c-login__main-footer-links">
                      ${(this.challenge.sources || []).map((source) => {
                          return this.renderSource(source);
                      })}
                  </ul> `
                : nothing}
            ${this.renderFooter()}
        </ak-flow-card>`;
    }

    //#endregion
}

declare global {
    interface HTMLElementTagNameMap {
        "ak-stage-identification": IdentificationStage;
    }
}
