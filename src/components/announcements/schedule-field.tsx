"use client";

import { useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { describedBy, Field, Select } from "@/components/ui/field";

/** "HH:mm" every 15 minutes, plus 11:59 PM for "end of day". */
const GRID = [...Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`), "23:59"];

export function timeLabel(key: string): string {
  const [h, m] = key.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Rounds "HH:mm" down to the 15-minute grid (a publish time slightly in the past goes live immediately). */
export function roundDownToGrid(key: string): string {
  const [h, m] = key.split(":").map(Number);
  return `${String(h).padStart(2, "0")}:${String(Math.floor(m / 15) * 15).padStart(2, "0")}`;
}

interface ScheduleFieldProps {
  /** Form field name; submitted as "YYYY-MM-DDTHH:mm" in church time (Asia/Manila), or "" when empty. */
  name: string;
  idPrefix: string;
  dateLabel: string;
  timeLabel: string;
  /** "YYYY-MM-DDTHH:mm" or "". */
  defaultValue: string;
  /** Today in church time, "YYYY-MM-DD". */
  today: string;
  /** Time used when a date is picked and no time is set yet. */
  fallbackTime: string;
  optional?: boolean;
  error?: string;
  hint?: string;
}

/** Separate date and time controls that submit one church-time value; the server converts it to an instant. */
export function ScheduleField({ name, idPrefix, dateLabel, timeLabel: timeText, defaultValue, today, fallbackTime, optional, error, hint }: ScheduleFieldProps) {
  const [date, setDate] = useState(defaultValue.slice(0, 10));
  const [time, setTime] = useState(defaultValue ? defaultValue.slice(11, 16) : fallbackTime);
  const options = GRID.includes(time) ? GRID : [...GRID, time].sort();
  const dateId = `${idPrefix}-date`;
  const timeId = `${idPrefix}-time`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-3">
      <input type="hidden" name={name} value={date ? `${date}T${time}` : ""} />
      <Field id={dateId} label={dateLabel} optional={optional} error={error} hint={hint}>
        <DatePicker
          id={dateId}
          value={date}
          onChange={setDate}
          today={today}
          placeholder={optional ? "No expiry" : "Choose a date"}
          clearable={optional}
          invalid={Boolean(error)}
          describedBy={describedBy(dateId, error, hint)}
        />
      </Field>
      <Field id={timeId} label={timeText}>
        <Select id={timeId} value={time} onChange={(event) => setTime(event.target.value)} disabled={optional && !date}>
          {options.map((key) => (
            <option key={key} value={key}>
              {timeLabel(key)}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
