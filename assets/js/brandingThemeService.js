import { APP_BUILD_LABEL } from "./config.js";

const DEFAULT_BRANDING = Object.freeze({
  companyName: "Visitor Management",
  productName: "Operations Hub",
  productSubtitle: "Operational workspace",
  logoUrl: null,
  logoTransparentBackground: false,
  headerLogoDisplayMode: "logo_and_name",
  headerLogoSize: "medium",
  faviconUrl: null,
  printLogoUrl: null,
  primaryColour: "#1f4f8f",
  accentColour: "#18a999",
  themeMode: "system",
  backgroundMode: "default",
  backgroundColor: "#eef3f8",
  backgroundGradientStartColor: "#f8fafc",
  backgroundGradientEndColor: "#e2e8f0",
  backgroundGradientDirection: "135deg",
  backgroundGradientStrength: "subtle",
  backgroundImageUrl: null,
  backgroundOpacity: 0.18,
  publicScreenBackgroundMode: "inherit_app",
  publicScreenBackgroundColor: "#f8fafc",
  publicScreenGradientStartColor: "#f8fafc",
  publicScreenGradientEndColor: "#e2e8f0",
  publicScreenGradientDirection: "135deg",
  publicScreenGradientStrength: "subtle",
  publicScreenBackgroundImageUrl: null,
  publicScreenBackgroundOpacity: 0.25,
  cornerStyle: "standard"
});

const HEADER_DISPLAY_MODES = new Set(["logo_and_name", "logo_only", "name_only", "default_mark_and_name"]);
const HEADER_LOGO_SIZES = new Set(["small", "medium", "large"]);
const THEME_MODES = new Set(["system", "light", "dark"]);
const BACKGROUND_MODES = new Set(["default", "solid_colour", "gradient", "image"]);
const PUBLIC_BACKGROUND_MODES = new Set(["inherit_app", "default", "solid_colour", "gradient", "image"]);
const CORNER_STYLES = new Set(["standard", "rounded", "square"]);
const GRADIENT_DIRECTIONS = new Set(["90deg", "135deg", "180deg", "225deg"]);
const GRADIENT_STRENGTHS = new Set(["subtle", "medium"]);

let currentBranding = { ...DEFAULT_BRANDING };
let defaultFaviconHref = null;
let systemThemeQuery = null;
let systemThemeListenerBound = false;
let lifecycleListenersBound = false;
let isApplyingBrandingTheme = false;
let lifecycleReapplyQueued = false;
let lastAppSettingsRef = null;
let lastSettingsSnapshot = {};
let lastBodyClassName = null;
let lastHtmlClassName = null;

const BRANDING_THEME_GUARD_STYLE_ID = "oh-branding-theme-guard";
const BRANDING_THEME_GUARD_CSS = [
  "html, body { text-size-adjust: 100%; -webkit-text-size-adjust: 100%; }",
  "body .operations-hub { font-size: var(--oh-font-size-base, 14px); line-height: var(--oh-line-height-base, 1.45); }",
  "body .oh-navigation, body .application-settings-section { font-size: var(--oh-font-size-base, 14px); line-height: var(--oh-line-height-base, 1.45); }",
  "body .oh-nav-item, body .oh-nav-child-item, body .application-settings-nav button { line-height: var(--oh-line-height-control, 1.25); }",
  "body .application-settings-control input, body .application-settings-control select, body .application-settings-control textarea { line-height: var(--oh-line-height-control, 1.25); }"
].join("\n");
const brandingDiagnosticsLogged = new Set();

function textValue(value, fallback = "") {
  const text = value == null ? "" : String(value).trim();
  return text || fallback;
}

function allowed(value, allowedValues, fallback) {
  const text = textValue(value, fallback);
  return allowedValues.has(text) ? text : fallback;
}

function boolValue(value, fallback = false) {
  if (value == null) return fallback;
  return value === true || value === "true";
}

function numberValue(value, fallback, min = null, max = null) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  if (min != null && next < min) return min;
  if (max != null && next > max) return max;
  return next;
}

export function isHexColour(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "").trim());
}

function colourValue(value, fallback) {
  const text = textValue(value);
  return isHexColour(text) ? text : fallback;
}

function optionalUrl(value) {
  const text = textValue(value);
  if (!text) return null;
  try {
    const parsed = new URL(text, window.location.href);
    if (["http:", "https:", "data:", "blob:"].includes(parsed.protocol)) return parsed.href;
  } catch {
    return null;
  }
  return null;
}

function cssUrl(value) {
  const url = optionalUrl(value);
  if (!url) return "none";
  return 'url("' + url.replace(/["\\]/g, "\\$&") + '")';
}

function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!match) return { r: 31, g: 79, b: 143 };
  const value = Number.parseInt(match[1], 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
}

function rgbString(hex) {
  const { r, g, b } = hexToRgb(hex);
  return r + ", " + g + ", " + b;
}

function contrastColour(hex) {
  const { r, g, b } = hexToRgb(hex);
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return yiq >= 150 ? "#101828" : "#ffffff";
}

function strongerColour(hex, amount = 0.18) {
  const { r, g, b } = hexToRgb(hex);
  return "#" + [r, g, b].map(channel => {
    const next = Math.max(0, Math.round(channel * (1 - amount)));
    return next.toString(16).padStart(2, "0");
  }).join("");
}

function softColour(hex, alpha = 0.12) {
  return "rgba(" + rgbString(hex) + ", " + alpha + ")";
}

function subtleGradient(direction, startColor, endColor, strength = "subtle") {
  const overlay = strength === "medium" ? 0.62 : 0.78;
  return "linear-gradient(" + direction + ", rgba(255,255,255," + overlay + "), rgba(255,255,255," + (overlay - 0.08) + ")), " +
    "linear-gradient(" + direction + ", " + startColor + " 0%, " + endColor + " 100%)";
}

function setToken(name, value) {
  document.documentElement.style.setProperty(name, value);
}

function warnOnce(key, message) {
  if (brandingDiagnosticsLogged.has(key) || typeof console === "undefined") return;
  brandingDiagnosticsLogged.add(key);
  console.warn("[BrandingTheme] " + message);
}

function ensureBrandingThemeGuardStyle() {
  const styles = Array.from(document.querySelectorAll("style#" + BRANDING_THEME_GUARD_STYLE_ID));
  let style = styles[0];
  if (!style) {
    style = document.createElement("style");
    style.id = BRANDING_THEME_GUARD_STYLE_ID;
    style.dataset.ohOwned = "branding-theme";
    document.head.appendChild(style);
  }
  if (styles.length > 1) {
    warnOnce("guard-style-duplicates", "Duplicate branding typography guard style tags were found and consolidated.");
    styles.slice(1).forEach(extraStyle => extraStyle.remove());
  }
  if (style.textContent !== BRANDING_THEME_GUARD_CSS) style.textContent = BRANDING_THEME_GUARD_CSS;
}

function runBrandingDiagnostics() {
  const shell = document.getElementById("operationsHubShell");
  if (shell && !shell.classList.contains("operations-hub")) {
    warnOnce("missing-shell-class", "Operations Hub shell is missing the operations-hub class.");
  }
  if (lastBodyClassName && !document.body.className) {
    warnOnce("body-class-cleared", "Body classes were cleared after branding had been applied.");
  }
  if (lastHtmlClassName && !document.documentElement.className) {
    warnOnce("html-class-cleared", "Document element classes were cleared after branding had been applied.");
  }
  lastBodyClassName = document.body.className;
  lastHtmlClassName = document.documentElement.className;
}

function queueLifecycleBrandingReapply() {
  if (lifecycleReapplyQueued || isApplyingBrandingTheme || !lastAppSettingsRef) return;
  lifecycleReapplyQueued = true;
  const run = () => {
    lifecycleReapplyQueued = false;
    if (isApplyingBrandingTheme || !lastAppSettingsRef) return;
    applyBrandingTheme(lastAppSettingsRef, lastSettingsSnapshot);
  };
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(run);
  } else {
    window.setTimeout(run, 0);
  }
}

function bindBrandingLifecycleReapply() {
  if (lifecycleListenersBound) return;
  window.addEventListener("focus", queueLifecycleBrandingReapply);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") queueLifecycleBrandingReapply();
  });
  lifecycleListenersBound = true;
}

function effectiveThemeMode(mode) {
  if (mode === "light" || mode === "dark") return mode;
  if (!systemThemeQuery && window.matchMedia) {
    systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  }
  return systemThemeQuery && systemThemeQuery.matches ? "dark" : "light";
}

function bindSystemThemeListener() {
  if (systemThemeListenerBound || !window.matchMedia) return;
  systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    if (currentBranding.themeMode === "system") applyThemeTokens(currentBranding);
  };
  if (typeof systemThemeQuery.addEventListener === "function") {
    systemThemeQuery.addEventListener("change", handler);
  } else if (typeof systemThemeQuery.addListener === "function") {
    systemThemeQuery.addListener(handler);
  }
  systemThemeListenerBound = true;
}

function applyThemeTokens(branding) {
  const theme = effectiveThemeMode(branding.themeMode);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.brandingThemeMode = branding.themeMode;

  const primary = branding.primaryColour;
  const accent = branding.accentColour;
  setToken("--brand", primary);
  setToken("--accent", accent);
  setToken("--oh-brand-primary", primary);
  setToken("--oh-brand-primary-strong", strongerColour(primary));
  setToken("--oh-brand-primary-soft", softColour(primary, theme === "dark" ? 0.22 : 0.12));
  setToken("--oh-brand-primary-contrast", contrastColour(primary));
  setToken("--oh-brand-accent", accent);
  setToken("--oh-brand-accent-strong", strongerColour(accent));
  setToken("--oh-brand-accent-soft", softColour(accent, theme === "dark" ? 0.24 : 0.14));
  setToken("--oh-brand-accent-contrast", contrastColour(accent));

  const dark = theme === "dark";
  setToken("--oh-app-background", dark ? "#101828" : "#f4f6f8");
  setToken("--oh-app-surface", dark ? "#182230" : "#ffffff");
  setToken("--oh-app-surface-muted", dark ? "#202b3c" : "#eef1f4");
  setToken("--oh-app-border", dark ? "#344054" : "#d9dee5");
  setToken("--oh-app-text", dark ? "#f9fafb" : "#1d2939");
  setToken("--oh-app-text-muted", dark ? "#cbd5e1" : "#667085");
  setToken("--oh-nav-background", dark ? "#111827" : "#ffffff");
  setToken("--oh-nav-active-background", softColour(primary, dark ? 0.28 : 0.14));
  setToken("--oh-nav-active-text", dark ? "#ffffff" : strongerColour(primary, 0.1));
  setToken("--oh-nav-hover-background", dark ? "#1f2937" : softColour(primary, 0.08));
  setToken("--oh-focus-ring", softColour(primary, 0.32));
  setToken("--oh-toast-accent", accent);
  setToken("--oh-shell-bg", "var(--oh-app-background)");
  setToken("--oh-shell-surface", "var(--oh-app-surface)");
  setToken("--oh-shell-subtle", "var(--oh-app-surface-muted)");
  setToken("--oh-shell-border", "var(--oh-app-border)");
  setToken("--oh-shell-text", "var(--oh-app-text)");
  setToken("--oh-shell-muted", "var(--oh-app-text-muted)");
  setToken("--oh-shell-active", "var(--oh-nav-active-background)");
  setToken("--oh-shell-focus", primary);
}

function applyCornerTokens(cornerStyle) {
  const radii = {
    standard: { base: "8px", card: "8px", button: "10px" },
    rounded: { base: "14px", card: "18px", button: "999px" },
    square: { base: "2px", card: "3px", button: "3px" }
  }[cornerStyle] || { base: "8px", card: "8px", button: "10px" };
  setToken("--oh-radius-base", radii.base);
  setToken("--oh-radius-card", radii.card);
  setToken("--oh-radius-button", radii.button);
  document.documentElement.dataset.ohCornerStyle = cornerStyle;
}

function backgroundCss(branding, publicScreen = false) {
  const mode = publicScreen ? branding.publicScreenBackgroundMode : branding.backgroundMode;
  const color = publicScreen ? branding.publicScreenBackgroundColor : branding.backgroundColor;
  const imageUrl = publicScreen ? branding.publicScreenBackgroundImageUrl : branding.backgroundImageUrl;
  const opacity = publicScreen ? branding.publicScreenBackgroundOpacity : branding.backgroundOpacity;
  const gradientStart = publicScreen ? branding.publicScreenGradientStartColor : branding.backgroundGradientStartColor;
  const gradientEnd = publicScreen ? branding.publicScreenGradientEndColor : branding.backgroundGradientEndColor;
  const gradientDirection = publicScreen ? branding.publicScreenGradientDirection : branding.backgroundGradientDirection;
  const gradientStrength = publicScreen ? branding.publicScreenGradientStrength : branding.backgroundGradientStrength;
  if (mode === "inherit_app" && publicScreen) return "var(--oh-branded-app-background)";
  if (mode === "solid_colour") return color;
  if (mode === "gradient") return subtleGradient(gradientDirection, gradientStart, gradientEnd, gradientStrength);
  if (mode === "image" && imageUrl) {
    const overlay = Math.max(0, Math.min(1, 1 - opacity));
    return "linear-gradient(rgba(248,250,252," + overlay + "), rgba(248,250,252," + overlay + ")), " + cssUrl(imageUrl);
  }
  if (mode === "default" && publicScreen) {
    return "radial-gradient(circle at top, rgba(47,111,173,.10), transparent 42%), #f5f7fa";
  }
  return "radial-gradient(circle at top left, rgba(" + rgbString(branding.primaryColour) + ", .08), transparent 32%), linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)";
}

function applyBackgroundTokens(branding) {
  const appBackground = backgroundCss(branding, false);
  const publicBackground = backgroundCss(branding, true) || backgroundCss(branding, false);
  setToken("--oh-branded-app-background", appBackground);
  setToken("--oh-branded-public-background", publicBackground);
  setToken("--oh-branded-public-background-size", branding.publicScreenBackgroundMode === "image" ? "cover" : "auto");
  setToken("--oh-branded-app-background-size", branding.backgroundMode === "image" ? "cover" : "auto");
  document.body.dataset.ohBrandingBackgroundMode = branding.backgroundMode;
  document.body.dataset.ohPublicBrandingBackgroundMode = branding.publicScreenBackgroundMode;
}

function updateDefaultFavicon() {
  if (defaultFaviconHref != null) return;
  const existing = document.querySelector("link[rel='icon'], link[rel='shortcut icon']");
  defaultFaviconHref = existing ? existing.getAttribute("href") || "" : "";
}

function applyFavicon(branding) {
  updateDefaultFavicon();
  let link = document.querySelector("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  const faviconUrl = optionalUrl(branding.faviconUrl);
  if (faviconUrl) {
    link.href = faviconUrl;
  } else if (defaultFaviconHref) {
    link.href = defaultFaviconHref;
  } else {
    link.removeAttribute("href");
  }
}

function setHeaderLogoImage(mark, branding, useLogo) {
  let img = mark.querySelector("img");
  if (!img) {
    img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    mark.appendChild(img);
  }
  const fallback = mark.querySelector("[data-oh-default-mark]");
  const logoUrl = optionalUrl(branding.logoUrl);
  const showLogo = useLogo && logoUrl;
  img.hidden = !showLogo;
  if (fallback) fallback.hidden = !!showLogo;
  if (showLogo) {
    img.src = logoUrl;
    img.onerror = () => {
      img.hidden = true;
      if (fallback) fallback.hidden = false;
      mark.classList.add("logo-load-failed");
    };
  } else {
    img.removeAttribute("src");
  }
}

function applyHeaderLogo(branding) {
  const product = document.querySelector(".oh-product");
  const mark = document.querySelector(".oh-product-mark");
  const name = document.querySelector(".oh-product-name");
  if (!product || !mark || !name) return;

  if (!mark.querySelector("[data-oh-default-mark]")) {
    const fallback = document.createElement("span");
    fallback.dataset.ohDefaultMark = "true";
    fallback.textContent = mark.textContent.trim() || "OH";
    mark.replaceChildren(fallback);
  }

  const displayMode = branding.headerLogoDisplayMode;
  const useLogo = displayMode === "logo_and_name" || displayMode === "logo_only";
  const showMark = displayMode !== "name_only";
  const showName = displayMode !== "logo_only";
  setHeaderLogoImage(mark, branding, useLogo);
  product.dataset.logoDisplayMode = displayMode;
  product.dataset.logoSize = branding.headerLogoSize;
  mark.classList.toggle("hidden", !showMark);
  name.classList.toggle("hidden", !showName);
  mark.classList.toggle("transparent-logo", !!branding.logoTransparentBackground);
  mark.classList.toggle("configured-logo", !!(useLogo && branding.logoUrl));
}

function applyLegacyVmsLogo(branding) {
  const logoImg = document.getElementById("brandLogoImg");
  const logoFallback = document.getElementById("brandLogoFallback");
  const brandMark = document.querySelector(".brand-mark");
  if (logoImg && logoFallback) {
    const logoUrl = optionalUrl(branding.logoUrl);
    if (logoUrl) {
      logoImg.src = logoUrl;
      logoImg.style.display = "block";
      logoImg.onerror = () => {
        logoImg.style.display = "none";
        logoFallback.style.display = "block";
      };
      logoFallback.style.display = "none";
    } else {
      logoImg.removeAttribute("src");
      logoImg.style.display = "none";
      logoFallback.style.display = "block";
    }
  }
  if (brandMark) brandMark.classList.toggle("transparent-logo", !!branding.logoTransparentBackground);
}

function applyProductText(appSettings, branding) {
  const brandText = document.querySelector(".brand div:last-child");
  if (brandText) {
    brandText.replaceChildren();
    brandText.append(document.createTextNode(branding.companyName));
    brandText.appendChild(document.createElement("br"));
    const version = document.createElement("span");
    version.style.fontSize = "12px";
    version.style.color = "var(--muted)";
    version.style.fontWeight = "700";
    version.textContent = "Operations Hub nextgen-ui - " + APP_BUILD_LABEL;
    brandText.appendChild(version);
  }
  const productName = document.querySelector(".oh-product-name strong");
  const productSubtitle = document.querySelector(".oh-product-name span");
  if (productName) productName.textContent = branding.productName;
  if (productSubtitle) productSubtitle.textContent = branding.productSubtitle;
  document.title = branding.productName + " - " + APP_BUILD_LABEL;

  let chip = document.getElementById("ohEnvironmentChip");
  if (!chip) {
    chip = document.createElement("span");
    chip.id = "ohEnvironmentChip";
    chip.className = "oh-environment-chip hidden";
    const actions = document.querySelector(".oh-header-actions");
    const settings = document.getElementById("ohSettingsShortcut");
    if (actions) actions.insertBefore(chip, settings || actions.firstChild);
  }
  const label = textValue(appSettings.environmentLabel);
  chip.textContent = label;
  chip.classList.toggle("hidden", !(appSettings.showEnvironmentLabel && label));
}

function applySharedTerminalText(appSettings) {
  const title = document.getElementById("terminalHomeTitle");
  if (title) title.textContent = appSettings.sharedTerminalHomeTitle || "How can we help?";
  const subtitle = document.querySelector(".terminal-home-hero > p:last-child");
  if (subtitle) subtitle.textContent = appSettings.sharedTerminalHomeSubtitle || "Select an available workflow below.";
  const staffLogin = document.getElementById("kioskStaffLoginButton");
  if (staffLogin) staffLogin.classList.toggle("hidden", appSettings.sharedTerminalShowStaffLoginButton === false);
}

export function brandingFromSettings(settings = {}, appSettings = {}) {
  return {
    companyName: textValue(settings.company_name, appSettings.companyName || DEFAULT_BRANDING.companyName),
    productName: textValue(settings.application_product_name, appSettings.productName || DEFAULT_BRANDING.productName),
    productSubtitle: textValue(settings.application_product_subtitle, appSettings.productSubtitle || DEFAULT_BRANDING.productSubtitle),
    logoUrl: optionalUrl(settings.logo_url),
    logoTransparentBackground: boolValue(settings.logo_transparent_background, DEFAULT_BRANDING.logoTransparentBackground),
    headerLogoDisplayMode: allowed(settings.branding_header_logo_display_mode, HEADER_DISPLAY_MODES, DEFAULT_BRANDING.headerLogoDisplayMode),
    headerLogoSize: allowed(settings.branding_header_logo_size, HEADER_LOGO_SIZES, DEFAULT_BRANDING.headerLogoSize),
    faviconUrl: optionalUrl(settings.branding_favicon_url),
    printLogoUrl: optionalUrl(settings.branding_print_logo_url),
    primaryColour: colourValue(settings.primary_colour, appSettings.primaryColour || DEFAULT_BRANDING.primaryColour),
    accentColour: colourValue(settings.accent_colour, appSettings.accentColour || DEFAULT_BRANDING.accentColour),
    themeMode: allowed(settings.branding_theme_mode, THEME_MODES, DEFAULT_BRANDING.themeMode),
    backgroundMode: allowed(settings.branding_background_mode, BACKGROUND_MODES, DEFAULT_BRANDING.backgroundMode),
    backgroundColor: colourValue(settings.page_background_colour, appSettings.pageBackgroundColour || DEFAULT_BRANDING.backgroundColor),
    backgroundGradientStartColor: colourValue(settings.branding_background_gradient_start_color, DEFAULT_BRANDING.backgroundGradientStartColor),
    backgroundGradientEndColor: colourValue(settings.branding_background_gradient_end_color, DEFAULT_BRANDING.backgroundGradientEndColor),
    backgroundGradientDirection: allowed(settings.branding_background_gradient_direction, GRADIENT_DIRECTIONS, DEFAULT_BRANDING.backgroundGradientDirection),
    backgroundGradientStrength: allowed(settings.branding_background_gradient_strength, GRADIENT_STRENGTHS, DEFAULT_BRANDING.backgroundGradientStrength),
    backgroundImageUrl: optionalUrl(settings.background_url),
    backgroundOpacity: numberValue(settings.background_opacity, DEFAULT_BRANDING.backgroundOpacity, 0, 1),
    publicScreenBackgroundMode: allowed(settings.branding_public_screen_background_mode, PUBLIC_BACKGROUND_MODES, DEFAULT_BRANDING.publicScreenBackgroundMode),
    publicScreenBackgroundColor: colourValue(settings.branding_public_screen_background_color, DEFAULT_BRANDING.publicScreenBackgroundColor),
    publicScreenGradientStartColor: colourValue(settings.branding_public_screen_gradient_start_color, DEFAULT_BRANDING.publicScreenGradientStartColor),
    publicScreenGradientEndColor: colourValue(settings.branding_public_screen_gradient_end_color, DEFAULT_BRANDING.publicScreenGradientEndColor),
    publicScreenGradientDirection: allowed(settings.branding_public_screen_gradient_direction, GRADIENT_DIRECTIONS, DEFAULT_BRANDING.publicScreenGradientDirection),
    publicScreenGradientStrength: allowed(settings.branding_public_screen_gradient_strength, GRADIENT_STRENGTHS, DEFAULT_BRANDING.publicScreenGradientStrength),
    publicScreenBackgroundImageUrl: optionalUrl(settings.branding_public_screen_background_image_url),
    publicScreenBackgroundOpacity: numberValue(settings.branding_public_screen_background_opacity, DEFAULT_BRANDING.publicScreenBackgroundOpacity, 0, 1),
    cornerStyle: allowed(settings.branding_corner_style, CORNER_STYLES, DEFAULT_BRANDING.cornerStyle)
  };
}

export function syncBrandingToAppSettings(appSettings, branding) {
  Object.assign(appSettings, {
    companyName: branding.companyName,
    productName: branding.productName,
    productSubtitle: branding.productSubtitle,
    logoUrl: branding.logoUrl,
    headerLogoDisplayMode: branding.headerLogoDisplayMode,
    headerLogoSize: branding.headerLogoSize,
    faviconUrl: branding.faviconUrl,
    printLogoUrl: branding.printLogoUrl,
    primaryColour: branding.primaryColour,
    accentColour: branding.accentColour,
    themeMode: branding.themeMode,
    backgroundMode: branding.backgroundMode,
    backgroundGradientStartColor: branding.backgroundGradientStartColor,
    backgroundGradientEndColor: branding.backgroundGradientEndColor,
    backgroundGradientDirection: branding.backgroundGradientDirection,
    backgroundGradientStrength: branding.backgroundGradientStrength,
    backgroundUrl: branding.backgroundImageUrl,
    backgroundOpacity: branding.backgroundOpacity,
    logoTransparentBackground: branding.logoTransparentBackground,
    pageBackgroundColour: branding.backgroundColor,
    publicScreenBackgroundMode: branding.publicScreenBackgroundMode,
    publicScreenBackgroundColor: branding.publicScreenBackgroundColor,
    publicScreenGradientStartColor: branding.publicScreenGradientStartColor,
    publicScreenGradientEndColor: branding.publicScreenGradientEndColor,
    publicScreenGradientDirection: branding.publicScreenGradientDirection,
    publicScreenGradientStrength: branding.publicScreenGradientStrength,
    publicScreenBackgroundImageUrl: branding.publicScreenBackgroundImageUrl,
    publicScreenBackgroundOpacity: branding.publicScreenBackgroundOpacity,
    cornerStyle: branding.cornerStyle
  });
}

export function applyBrandingTheme(appSettings, settings = {}) {
  if (isApplyingBrandingTheme) return { ...currentBranding };
  isApplyingBrandingTheme = true;
  try {
    lastAppSettingsRef = appSettings;
    lastSettingsSnapshot = settings && typeof settings === "object" ? { ...settings } : {};
    const branding = brandingFromSettings(settings, appSettings);
    syncBrandingToAppSettings(appSettings, branding);
    currentBranding = { ...branding };
    bindSystemThemeListener();
    bindBrandingLifecycleReapply();
    ensureBrandingThemeGuardStyle();
    applyThemeTokens(branding);
    applyCornerTokens(branding.cornerStyle);
    applyBackgroundTokens(branding);
    applyProductText(appSettings, branding);
    applyHeaderLogo(branding);
    applyLegacyVmsLogo(branding);
    applyFavicon(branding);
    applySharedTerminalText(appSettings);
    runBrandingDiagnostics();
    window.dispatchEvent(new CustomEvent("oh:branding-theme-applied", {
      detail: { branding: { ...branding } }
    }));
    return branding;
  } finally {
    isApplyingBrandingTheme = false;
  }
}

export function getCurrentBranding() {
  return { ...currentBranding };
}

export function getPrintLogoUrl(appSettings = null) {
  const source = appSettings || currentBranding;
  return source.printLogoUrl || source.logoUrl || currentBranding.printLogoUrl || currentBranding.logoUrl || "";
}

export function brandingImplementationStatus(settingKey) {
  const statuses = {
    "branding.logo_url": ["Applied", "Header, legacy header, public screens and print fallback."],
    "branding.logo_transparent_background": ["Applied", "Controls shaped vs transparent logo containers."],
    "branding.theme_mode": ["Applied", "Applies light, dark or system shell tokens."],
    "branding.primary_color": ["Applied", "Buttons, active navigation, focus and selected states."],
    "branding.accent_color": ["Applied", "Secondary highlights, chips and toast accent tokens."],
    "branding.background_mode": ["Applied", "Controls app background mode."],
    "branding.background_color": ["Applied", "Visible shell/workspace background for solid colour mode."],
    "branding.background_gradient_start_color": ["Applied", "Used for subtle app gradient mode."],
    "branding.background_gradient_end_color": ["Applied", "Used for subtle app gradient mode."],
    "branding.background_gradient_direction": ["Applied", "Controls subtle app gradient direction."],
    "branding.background_gradient_strength": ["Applied", "Controls subtle or medium app gradient visibility."],
    "branding.background_image_url": ["Applied", "Used for app background image mode when set."],
    "branding.background_opacity": ["Applied", "Controls app background image overlay opacity."],
    "branding.header_logo_display_mode": ["Applied", "Controls header logo/name visibility."],
    "branding.header_logo_size": ["Applied", "Controls header logo dimensions."],
    "branding.favicon_url": ["Applied", "Updates browser favicon link when set."],
    "branding.print_logo_url": ["Applied", "Used by supported print outputs, with main logo fallback."],
    "branding.public_screen_background_mode": ["Applied", "Controls Shared Terminal and visitor kiosk backgrounds."],
    "branding.public_screen_background_color": ["Applied", "Used for public solid colour mode."],
    "branding.public_screen_gradient_start_color": ["Applied", "Used for subtle public-screen gradient mode."],
    "branding.public_screen_gradient_end_color": ["Applied", "Used for subtle public-screen gradient mode."],
    "branding.public_screen_gradient_direction": ["Applied", "Controls subtle public-screen gradient direction."],
    "branding.public_screen_gradient_strength": ["Applied", "Controls subtle or medium public-screen gradient visibility."],
    "branding.public_screen_background_image_url": ["Applied", "Used for public image mode when set."],
    "branding.public_screen_background_opacity": ["Applied", "Controls public image overlay opacity."],
    "branding.corner_style": ["Applied", "Controls shared radius tokens for cards, buttons, panels and inputs."]
  };
  const entry = statuses[settingKey];
  return entry ? { label: entry[0], detail: entry[1] } : null;
}
