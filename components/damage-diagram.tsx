"use client";

import { Trash2, Undo2 } from "lucide-react";

import { useState } from "react";

import {
  DAMAGE_KINDS,
  DAMAGE_VIEWS,
  MAX_DAMAGE_MARKS,
  damageKindOf,
  damageViewLabel,
  newDamageMarkId,
  summariseDamage,
  type DamageKind,
  type DamageMark,
  type DamageView,
} from "@/lib/damage";

/*
 * The four outline drawings from the paper agreement, with the
 * damage marked on them. Pick what kind of damage it is, then
 * tap the drawing where it is; tap a mark again to take it
 * off. Without `onChange` the drawings are shown read-only.
 *
 * `baseline` is the damage the vehicle already had when this
 * form opened. Anything marked since is drawn in red, so new
 * damage at a return stands out from what went out with it.
 */
export function DamageDiagram({
  marks,
  onChange,
  baseline,
  label = "Vehicle damage",
  hint,
  disabled = false,
}: {
  marks: DamageMark[];
  onChange?: (marks: DamageMark[]) => void;
  baseline?: DamageMark[];
  label?: string;
  hint?: string;
  disabled?: boolean;
}) {
  const [kind, setKind] =
    useState<DamageKind>("scratch");

  const editable = Boolean(onChange) && !disabled;

  const baselineIds = new Set(
    (baseline ?? []).map((mark) => mark.id),
  );

  const isNew = (mark: DamageMark) =>
    baseline !== undefined &&
    !baselineIds.has(mark.id);

  const newCount = marks.filter(isNew).length;

  function addMark(
    view: DamageView,
    event: React.MouseEvent<HTMLDivElement>,
  ) {
    if (!editable || !onChange) {
      return;
    }

    if (marks.length >= MAX_DAMAGE_MARKS) {
      return;
    }

    const box =
      event.currentTarget.getBoundingClientRect();

    if (box.width === 0 || box.height === 0) {
      return;
    }

    const x = Math.min(
      Math.max(
        (event.clientX - box.left) / box.width,
        0,
      ),
      1,
    );

    const y = Math.min(
      Math.max(
        (event.clientY - box.top) / box.height,
        0,
      ),
      1,
    );

    onChange([
      ...marks,
      {
        id: newDamageMarkId(),
        view,
        x: Math.round(x * 10_000) / 10_000,
        y: Math.round(y * 10_000) / 10_000,
        kind,
        notedAt: new Date().toISOString(),
      },
    ]);
  }

  function removeMark(id: string) {
    if (!editable || !onChange) {
      return;
    }

    onChange(
      marks.filter((mark) => mark.id !== id),
    );
  }

  return (
    <div className="damage-diagram">
      <div className="damage-diagram-head">
        <div>
          <strong>{label}</strong>

          <small>
            {summariseDamage(marks)}
            {baseline !== undefined &&
              newCount > 0 &&
              ` · ${newCount} new`}
          </small>
        </div>

        {editable && marks.length > 0 && (
          <button
            className="text-button"
            type="button"
            onClick={() =>
              removeMark(
                marks[marks.length - 1].id,
              )
            }
          >
            <Undo2 size={14} />
            Undo last
          </button>
        )}
      </div>

      {hint && editable && (
        <p className="form-help">{hint}</p>
      )}

      {editable && (
        <div
          className="damage-kinds"
          role="radiogroup"
          aria-label="Kind of damage to mark"
        >
          {DAMAGE_KINDS.map((entry) => (
            <button
              key={entry.kind}
              type="button"
              role="radio"
              aria-checked={kind === entry.kind}
              className={
                kind === entry.kind
                  ? "damage-kind is-selected"
                  : "damage-kind"
              }
              onClick={() => setKind(entry.kind)}
            >
              <span
                className={`damage-pin damage-pin-${entry.kind}`}
                aria-hidden="true"
              >
                {entry.letter}
              </span>
              {entry.label}
            </button>
          ))}
        </div>
      )}

      <div className="damage-views">
        {DAMAGE_VIEWS.map((view) => (
          <figure
            key={view.view}
            className={`damage-view damage-view-${view.view}`}
          >
            <div
              className={
                editable
                  ? "damage-canvas is-editable"
                  : "damage-canvas"
              }
              onClick={(event) =>
                addMark(view.view, event)
              }
            >
              <img
                src={view.src}
                alt={`${view.label} of the vehicle`}
                draggable={false}
              />

              {marks
                .filter(
                  (mark) =>
                    mark.view === view.view,
                )
                .map((mark) => {
                  const meta = damageKindOf(
                    mark.kind,
                  );

                  const className = `damage-pin damage-pin-${mark.kind}${
                    isNew(mark) ? " is-new" : ""
                  }`;

                  const style = {
                    left: `${mark.x * 100}%`,
                    top: `${mark.y * 100}%`,
                  };

                  return editable ? (
                    <button
                      key={mark.id}
                      type="button"
                      className={`${className} is-placed`}
                      style={style}
                      title={`Remove ${meta.label.toLowerCase()}`}
                      aria-label={`Remove ${meta.label.toLowerCase()} on the ${view.label.toLowerCase()}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeMark(mark.id);
                      }}
                    >
                      {meta.letter}
                    </button>
                  ) : (
                    <span
                      key={mark.id}
                      className={`${className} is-placed`}
                      style={style}
                      title={meta.label}
                    >
                      {meta.letter}
                    </span>
                  );
                })}
            </div>

            <figcaption>{view.label}</figcaption>
          </figure>
        ))}
      </div>

      {marks.length > 0 && (
        <ul className="damage-list">
          {marks.map((mark) => {
            const meta = damageKindOf(mark.kind);

            return (
              <li key={mark.id}>
                <span
                  className={`damage-pin damage-pin-${mark.kind}${
                    isNew(mark) ? " is-new" : ""
                  }`}
                  aria-hidden="true"
                >
                  {meta.letter}
                </span>

                <span>
                  {meta.label} ·{" "}
                  {damageViewLabel(mark.view)}
                  {isNew(mark) && (
                    <em> · new</em>
                  )}
                </span>

                {editable && (
                  <button
                    className="text-button"
                    type="button"
                    aria-label={`Remove ${meta.label.toLowerCase()} on the ${damageViewLabel(
                      mark.view,
                    ).toLowerCase()}`}
                    onClick={() =>
                      removeMark(mark.id)
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
