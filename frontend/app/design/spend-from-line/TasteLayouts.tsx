import {
  Accounts,
  CardActivity,
  CardExplanation,
  CardReadout,
  CashFigure,
  CashFooter,
  CashHeader,
  CashScope,
  CashWorking,
  PeriodReadout,
  type TasteModel,
} from "./TasteFacts";

export type TasteVariant = "g" | "h" | "i";

type Props = {
  variant: TasteVariant;
  model: TasteModel;
};

function CashAndCardSummary({ model }: Pick<Props, "model">) {
  const figureAndCardClass = !model.cards
    ? "mt-5"
    : model.largeCash
    ? "mt-5 grid gap-4"
    : "mt-5 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-4 sm:gap-6";

  return (
    <section data-taste-main aria-labelledby="taste-cash-label taste-cash-heading" className="glass-hero min-w-0 rounded-2xl p-5">
      <CashHeader model={model} />
      <div className={figureAndCardClass}>
        <CashFigure model={model} />
        {model.cards && <CardReadout model={model} />}
      </div>
      <CashScope model={model} />
      <Accounts model={model} />
      {model.cards && <CardExplanation model={model} />}
      <CashWorking model={model} />
      <div className="mt-4">
        <CashFooter model={model} />
      </div>
    </section>
  );
}

function CompactStatement({ model }: Pick<Props, "model">) {
  const figureAndPeriodClass = model.largeCash
    ? "mt-5 grid gap-3"
    : "mt-5 flex items-end justify-between gap-4";

  return (
    <section data-taste-main aria-labelledby="taste-cash-label taste-cash-heading" className="glass-hero min-w-0 rounded-2xl p-5">
      <CashHeader model={model} />
      <div className={figureAndPeriodClass}>
        <CashFigure model={model} />
        <PeriodReadout model={model} />
      </div>
      <CashScope model={model} />
      <Accounts model={model} compact />
      {model.cards && (
        <div className="mt-4 border-t border-slate-100 pt-2 dark:border-white/10">
          <CardActivity model={model} compact />
        </div>
      )}
      <CashWorking model={model} />
      <div className="mt-4">
        <CashFooter model={model} periodInHeader />
      </div>
    </section>
  );
}

function SeparateInstruments({ model }: Pick<Props, "model">) {
  return (
    <div className="grid min-w-0 gap-3">
      <section data-taste-main aria-labelledby="taste-cash-label taste-cash-heading" className="glass-hero min-w-0 rounded-2xl p-5">
        <CashHeader model={model} />
        <div className="mt-5">
          <CashFigure model={model} />
        </div>
        <CashScope model={model} />
        <Accounts model={model} />
        <CashWorking model={model} />
        <div className="mt-4">
          <CashFooter model={model} />
        </div>
      </section>
      {model.cards && (
        <div data-taste-secondary className="glass-card min-w-0 rounded-2xl p-5">
          <CardActivity model={model} />
        </div>
      )}
    </div>
  );
}

export function TasteLayouts({ variant, model }: Props) {
  return (
    <div data-g320-taste={variant} className="min-w-0">
      {variant === "g" && <CashAndCardSummary model={model} />}
      {variant === "h" && <CompactStatement model={model} />}
      {variant === "i" && <SeparateInstruments model={model} />}
    </div>
  );
}
