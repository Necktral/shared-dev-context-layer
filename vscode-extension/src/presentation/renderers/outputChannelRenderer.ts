import type * as vscode from "vscode";
import type { OperationalContextViewModel } from "../viewModels";

export class OutputChannelRenderer {
  constructor(private readonly output: vscode.OutputChannel) {}

  public render(viewModel: OperationalContextViewModel): void {
    this.output.appendLine("[WIS] load_operational_context");
    this.output.appendLine(viewModel.title);

    for (const section of viewModel.sections) {
      this.output.appendLine("");
      this.output.appendLine(`== ${section.title} ==`);
      for (const entry of section.entries) {
        this.output.appendLine(`${entry.label}: ${entry.value}`);
      }
    }

    this.output.appendLine("");
    this.output.show(true);
  }
}
