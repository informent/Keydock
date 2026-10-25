import { useId, useState } from "react";
import { Activity, ArrowUpRight } from "lucide-react";
import { number } from "./api";
import type { Overview } from "./types";

const dayLabel = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`),
  );

export function RequestActivity({ data }: { data: Overview | null }) {
  const [period, setPeriod] = useState(14),
    [active, setActive] = useState<number | null>(null),
    gradient = useId();
  const counts = Array.from({ length: period }, (_, index) => {
    const day = new Date(
      (data?.now ?? Date.now()) - (period - 1 - index) * 86400000,
    )
      .toISOString()
      .slice(0, 10);
    return {
      day,
      valid:
        data?.activity
          .filter((entry) => entry.day === day && entry.outcome === "valid")
          .reduce((n, entry) => n + entry.count, 0) ?? 0,
      denied:
        data?.activity
          .filter((entry) => entry.day === day && entry.outcome === "denied")
          .reduce((n, entry) => n + entry.count, 0) ?? 0,
    };
  });
  const total = counts.reduce((sum, day) => sum + day.valid + day.denied, 0),
    valid = counts.reduce((sum, day) => sum + day.valid, 0);
  const ceiling = Math.max(
    4,
    Math.ceil(
      Math.max(...counts.map((day) => Math.max(day.valid, day.denied))) / 4,
    ) * 4,
  );
  const x = (index: number) => 12 + (index / (period - 1)) * 676,
    y = (value: number) => 168 - (value / ceiling) * 144;
  const path = (kind: "valid" | "denied") =>
    counts
      .map((day, index) => `${index ? "L" : "M"}${x(index)},${y(day[kind])}`)
      .join(" ");
  const selected =
    active === null ? null : counts[Math.min(active, counts.length - 1)];
  return (
    <section className="panel request-activity">
      <div className="section-heading">
        <div>
          <h2>License requests</h2>
          <p>Every activation and validation, in view.</p>
        </div>
        <select
          aria-label="Request period"
          className="period-select"
          value={period}
          onChange={(event) => {
            setPeriod(Number(event.target.value));
            setActive(null);
          }}
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
        </select>
      </div>
      <div className="request-headline">
        <div>
          <strong>{data ? number(total) : "—"}</strong>
          <span>total requests</span>
        </div>
        <div className="request-readout" aria-live="polite">
          {selected ? (
            <>
              <strong>
                {dayLabel(selected.day, { month: "short", day: "numeric" })}
              </strong>
              <span>
                {number(selected.valid)} valid · {number(selected.denied)}{" "}
                denied
              </span>
            </>
          ) : (
            <>
              <strong>
                {total
                  ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format((valid / total) * 100)}% accepted`
                  : "Awaiting activity"}
              </strong>
              <span>
                {total
                  ? "For the selected period"
                  : "Requests appear as devices connect"}
              </span>
            </>
          )}
        </div>
      </div>
      <div
        className="request-plot"
        tabIndex={0}
        role="group"
        aria-label={`License requests chart, ${total} requests in ${period} days. Use the left and right arrow keys to explore daily counts.`}
        onFocus={() => setActive(period - 1)}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            setActive(
              Math.min(
                period - 1,
                Math.max(
                  0,
                  (active ?? period - 1) + (event.key === "ArrowLeft" ? -1 : 1),
                ),
              ),
            );
          }
        }}
      >
        <div className="request-axis" aria-hidden="true">
          <span>{number(ceiling)}</span>
          <span>{number(ceiling / 2)}</span>
          <span>0</span>
        </div>
        <svg
          viewBox="0 0 700 190"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${number(valid)} valid requests and ${number(total - valid)} denied requests`}
        >
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" className="area-start" />
              <stop offset="100%" className="area-end" />
            </linearGradient>
          </defs>
          {[24, 96, 168].map((position) => (
            <line
              key={position}
              x1="0"
              y1={position}
              x2="700"
              y2={position}
              className="request-gridline"
            />
          ))}
          {total > 0 && (
            <>
              <path
                d={`${path("valid")} L688,168 L12,168 Z`}
                fill={`url(#${gradient})`}
              />
              <path d={path("valid")} className="request-line valid" />
              {total > valid && (
                <path d={path("denied")} className="request-line denied" />
              )}
              {active !== null && (
                <g>
                  <line
                    x1={x(Math.min(active, period - 1))}
                    x2={x(Math.min(active, period - 1))}
                    y1="15"
                    y2="175"
                    className="request-cursor"
                  />
                  <circle
                    cx={x(Math.min(active, period - 1))}
                    cy={y(selected?.valid ?? 0)}
                    r="4"
                    className="request-dot"
                  />
                </g>
              )}
            </>
          )}
          {counts.map((day, index) => (
            <rect
              key={day.day}
              x={Math.max(0, x(index) - 350 / (period - 1))}
              y="0"
              width={700 / (period - 1)}
              height="190"
              fill="transparent"
              onMouseEnter={() => setActive(index)}
            >
              <title>
                {day.day}: {day.valid} valid, {day.denied} denied
              </title>
            </rect>
          ))}
        </svg>
        {data && !total && (
          <div className="request-empty">
            <Activity size={23} />
            <strong>A quiet start</strong>
            <span>Your first request will appear here.</span>
          </div>
        )}
      </div>
      <div className="request-dates">
        <span>
          {dayLabel(counts[0].day, { month: "short", day: "numeric" })}
        </span>
        <span>
          {dayLabel(counts[Math.floor((period - 1) / 2)].day, {
            month: "short",
            day: "numeric",
          })}
        </span>
        <span>
          {dayLabel(counts[period - 1].day, { month: "short", day: "numeric" })}
        </span>
      </div>
      <div className="request-footer">
        <div>
          <span className="legend valid" /> Valid{" "}
          <span className="legend denied" /> Denied
        </div>
        <a href="#/activity">
          View activity <ArrowUpRight size={14} />
        </a>
      </div>
    </section>
  );
}
