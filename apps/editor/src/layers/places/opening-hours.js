// Opening hours as someone edits them, and the OpenStreetMap text they are stored as. Only what the editor can show is
// parsed; anything else stays the text it was.
export const dayNames = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su', 'PH'];
const weekdayCount = 7;
export const alwaysOpenText = '24/7';
const closedWords = new Set(['off', 'closed']);
const timePattern = /^([01]?\d|2[0-4]):([0-5]\d)$/;

const paddedTime = time => time.padStart(5, '0');

export const isTime = value => timePattern.test(value);

function daysOfPart(part) {
  const [first, last] = part.split('-');
  const start = dayNames.indexOf(first);
  if (start < 0) return null;
  if (last === undefined) return [first];
  const end = dayNames.indexOf(last);
  const isWeekdayRange = start < weekdayCount && end >= 0 && end < weekdayCount;
  if (!isWeekdayRange) return null;
  const length = ((end - start + weekdayCount) % weekdayCount) + 1;
  return Array.from({length}, (_unused, offset) => dayNames[(start + offset) % weekdayCount]);
}

function parsedDays(text) {
  const parts = text.split(',').map(daysOfPart);
  return parts.includes(null) ? null : parts.flat();
}

function parsedIntervals(text) {
  const intervals = text.split(',').map(interval => interval.split('-'));
  const areTimes = intervals.every(interval => interval.length === 2 && interval.every(isTime));
  return areTimes ? intervals.map(([from, to]) => ({from: paddedTime(from), to: paddedTime(to)})) : null;
}

// One rule: "Mo-Fr 08:00-16:00", "08:00-16:00" for every day, or "Su off".
function parsedGroup(text) {
  const words = text.trim().split(/\s+/);
  const hasDays = words.length === 2;
  if (words.length > 2 || words[0] === '') return null;
  const days = hasDays ? parsedDays(words[0]) : dayNames.slice(0, weekdayCount);
  const hours = words.at(-1);
  if (!days) return null;
  if (closedWords.has(hours)) return {days, intervals: []};
  const intervals = parsedIntervals(hours);
  return intervals && {days, intervals};
}

// Returns {isAlwaysOpen, groups: [{days, intervals: [{from, to}]}]}, or null when the text says something the editor
// cannot show. A group without intervals is closed.
export function parseOpeningHours(text) {
  if (text.trim() === alwaysOpenText) return {isAlwaysOpen: true, groups: []};
  const groups = text.split(';').map(parsedGroup);
  return groups.includes(null) ? null : {isAlwaysOpen: false, groups};
}

function dayRanges(days) {
  const indices = dayNames.slice(0, weekdayCount).flatMap((day, index) => (days.includes(day) ? [index] : []));
  const ranges = [];
  for (const index of indices) {
    const current = ranges.at(-1);
    if (current && current.end === index - 1) current.end = index;
    else ranges.push({start: index, end: index});
  }
  const texts = ranges.map(({start, end}) => (start === end ? dayNames[start] : `${dayNames[start]}-${dayNames[end]}`));
  return [...texts, ...(days.includes('PH') ? ['PH'] : [])].join(',');
}

function groupText({days, intervals}) {
  const hours = intervals.length === 0 ? 'off' : intervals.map(({from, to}) => `${from}-${to}`).join(',');
  return `${dayRanges(days)} ${hours}`;
}

// The OpenStreetMap text of a model.
export function formatOpeningHours({isAlwaysOpen, groups}) {
  if (isAlwaysOpen) return alwaysOpenText;
  return groups.filter(({days}) => days.length > 0).map(groupText).join('; ');
}

// Returns why a model cannot be stored, or null.
export function openingHoursProblem({isAlwaysOpen, groups}) {
  if (isAlwaysOpen) return null;
  const usedDays = groups.flatMap(({days}) => days);
  if (usedDays.length === 0) return 'Choose at least one day.';
  if (new Set(usedDays).size !== usedDays.length) return 'A day is in two groups.';
  const intervals = groups.flatMap(group => group.intervals);
  if (!intervals.every(({from, to}) => isTime(from) && isTime(to))) return 'Enter each time as 08:00.';
  return intervals.some(({from, to}) => from === to) ? 'Opening and closing time are the same.' : null;
}

const workingDay = {from: '08:00', to: '20:00'};
const weekdays = dayNames.slice(0, 5);
const weekend = dayNames.slice(5, 7);

// What someone usually starts from.
export const openingHoursPresets = [
  {label: 'Same every day', model: {isAlwaysOpen: false, groups: [{days: dayNames.slice(0, 7), intervals: [workingDay]}]}},
  {
    label: 'Weekdays + weekend',
    model: {
      isAlwaysOpen: false,
      groups: [
        {days: weekdays, intervals: [workingDay]},
        {days: weekend, intervals: [{from: '10:00', to: '18:00'}]}
      ]
    }
  },
  {label: '24/7', model: {isAlwaysOpen: true, groups: []}},
  {label: 'Closed', model: {isAlwaysOpen: false, groups: [{days: dayNames.slice(0, 7), intervals: []}]}}
];
