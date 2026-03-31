import type { OperationalContextEnvelope } from "../domain/operationalContext";
import { OutputChannelRenderer } from "./renderers/outputChannelRenderer";
import { ViewModelMapper } from "./viewModels";

export class ContextPresenter {
  constructor(
    private readonly mapper: ViewModelMapper,
    private readonly renderer: OutputChannelRenderer,
  ) {}

  public present(envelope: OperationalContextEnvelope): void {
    const viewModel = this.mapper.map(envelope);
    this.renderer.render(viewModel);
  }
}
