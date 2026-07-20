import { registerModuleConfiguration } from "./moduleConfiguration.js";
import { fillSettingsForm } from "./settings.js";

const MODULE_CONFIGURATION_VIEW = [
  "module_configuration.view",
  "module_configuration.manage"
];

const VISITOR_CONFIGURATION_VIEW = [
  ...MODULE_CONFIGURATION_VIEW,
  "visitor.housekeeping.run"
];

export function registerInitialModuleConfigurations() {
  registerModuleConfiguration({
    id: "visitors",
    name: "Visitors",
    icon: "V",
    description: "Visitor behaviour, walk-ins, messages, operational rules and housekeeping.",
    viewCapabilities: VISITOR_CONFIGURATION_VIEW,
    manageCapabilities: [
      "module_configuration.manage",
      "settings.edit"
    ],
    groups: [
      {
        name: "Visitor Experience",
        description: "Visitor-facing behaviour, messages, privacy and form rules.",
        sourceAnchors: [
          "settingKioskTimeout",
          "settingSignInMessage",
          "settingPlannedReasonVisible",
          "settingPrivacyNoticeEnabled"
        ]
      },
      {
        name: "Visitor Operations",
        description: "Operational requirements, automatic sign-out and planned visit lifecycle.",
        sourceAnchors: [
          "settingAutoEod",
          "settingPlannedCompletedCleanupMode"
        ]
      },
      {
        name: "Visitor Housekeeping",
        description: "Retention settings, previews and controlled manual housekeeping.",
        sourceAnchors: [
          "settingRetentionPlannedDays",
          "visitorHousekeepingControls",
          "previewRetentionButton"
        ]
      },
      {
        name: "Visitor Compliance",
        description: "Existing visitor agreement and induction behaviour.",
        sourceAnchors: [
          "settingVisitorAgreementsEnabled"
        ]
      }
    ],
    onOpen: fillSettingsForm
  });

  [
    ["people", "People", "P", "People directory and lifecycle configuration."],
    ["organisations", "Organisations", "O", "Organisation relationship and master-data configuration."],
    ["planning", "Planning", "P", "Planning calendars and resource configuration."],
    ["compliance", "Compliance", "C", "Compliance rules and evidence configuration."],
    ["assets", "Assets", "A", "Asset lifecycle and assignment configuration."],
    ["employee-relations", "Employee Relations", "ER", "Employee relations workflow configuration."],
    ["labour", "Labour", "L", "Labour entry, validation and allocation configuration."],
    ["reporting", "Reporting", "R", "Reporting defaults and governed output configuration."]
  ].forEach(([id, name, icon, description]) => {
    registerModuleConfiguration({
      id,
      name,
      icon,
      description,
      placeholder: true,
      viewCapabilities: MODULE_CONFIGURATION_VIEW
    });
  });
}
