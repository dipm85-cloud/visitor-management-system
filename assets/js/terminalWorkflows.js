import { registerTerminalWorkflow } from "./terminal.js";

export function registerInitialTerminalWorkflows() {
  registerTerminalWorkflow({
    id: "visitors",
    name: "Visitors",
    icon: "V",
    description: "Visitor sign-in and sign-out.",
    open() {
      window.dispatchEvent(new CustomEvent("oh:terminal-workflow-requested", {
        detail: { workflowId: "visitors" }
      }));
    }
  });

  [
    ["employee-attendance", "Employee Attendance", "EA"],
    ["contractors", "Contractors", "C"],
    ["drivers", "Drivers", "D"]
  ].forEach(([id, name, icon]) => {
    registerTerminalWorkflow({
      id,
      name,
      icon,
      description: name + " terminal workflow.",
      enabled: false
    });
  });
}
