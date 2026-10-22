import { deflateSync } from 'node:zlib'

export interface FontBuilderOptions {
  family: string
  /** `usWeightClass` written into OS/2 (0 leaves it zeroed, like an omitted table value). */
  weightClass?: number
  /** Sets fsSelection italic bit in OS/2. */
  italicSelection?: boolean
  /** Adds a typographic family (name id 16) next to the style-linked family (name id 1). */
  typographicFamily?: string
  /** 'mac' writes Mac Roman (ASCII) name records, 'windows' (default) writes UTF-16BE. */
  platform?: 'mac' | 'windows'
  /** `head.macStyle` bits (1 bold, 2 italic). */
  macStyle?: number
  /** `post.italicAngle` (non-zero means slanted). */
  italicAngle?: number
}

type NameId = 1 | 16

interface NameRecord {
  platform: number
  encoding: number
  language: number
  nameId: NameId
  bytes: Uint8Array
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function utf16be(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 2)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    bytes[i * 2] = code >> 8
    bytes[i * 2 + 1] = code & 0xff
  }
  return bytes
}

function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0x7f
  return bytes
}

function nameRecords(options: FontBuilderOptions): NameRecord[] {
  const windows = (options.platform ?? 'windows') === 'windows'
  const make = (nameId: NameId, value: string): NameRecord =>
    windows
      ? { platform: 3, encoding: 1, language: 0x409, nameId, bytes: utf16be(value) }
      : { platform: 1, encoding: 0, language: 0, nameId, bytes: ascii(value) }
  const records = [make(1, options.family)]
  if (options.typographicFamily) records.push(make(16, options.typographicFamily))
  return records
}

function buildNameTable(records: NameRecord[]): Uint8Array {
  const stringOffset = 6 + records.length * 12
  const header = new Uint8Array(stringOffset)
  const view = new DataView(header.buffer)
  view.setUint16(0, 0) // format
  view.setUint16(2, records.length)
  view.setUint16(4, stringOffset)
  const strings: Uint8Array[] = []
  let offset = 0
  records.forEach((record, index) => {
    const at = 6 + index * 12
    view.setUint16(at, record.platform)
    view.setUint16(at + 2, record.encoding)
    view.setUint16(at + 4, record.language)
    view.setUint16(at + 6, record.nameId)
    view.setUint16(at + 8, record.bytes.length)
    view.setUint16(at + 10, offset)
    strings.push(record.bytes)
    offset += record.bytes.length
  })
  return concat(header, ...strings)
}

function buildOs2Table(options: FontBuilderOptions): Uint8Array {
  const table = new Uint8Array(96)
  const view = new DataView(table.buffer)
  view.setUint16(0, 4) // version
  view.setUint16(4, options.weightClass ?? 0) // usWeightClass
  view.setUint16(62, options.italicSelection ? 1 : 0) // fsSelection
  return table
}

function buildHeadTable(options: FontBuilderOptions): Uint8Array {
  const table = new Uint8Array(54)
  const view = new DataView(table.buffer)
  view.setUint32(0, 0x00010000) // version
  view.setUint16(44, options.macStyle ?? 0) // macStyle
  return table
}

function buildPostTable(options: FontBuilderOptions): Uint8Array {
  const table = new Uint8Array(32)
  const view = new DataView(table.buffer)
  view.setUint32(0, 0x00030000) // version 3.0
  view.setInt32(4, Math.round((options.italicAngle ?? 0) * 65536)) // italicAngle, 16.16 fixed
  return table
}

/** The four sfnt tables the builder emits, sorted by tag like real fonts. */
function fontTables(options: FontBuilderOptions): Array<{ tag: string; data: Uint8Array }> {
  return [
    { tag: 'OS/2', data: buildOs2Table(options) },
    { tag: 'head', data: buildHeadTable(options) },
    { tag: 'name', data: buildNameTable(nameRecords(options)) },
    { tag: 'post', data: buildPostTable(options) },
  ].sort((a, b) => (a.tag < b.tag ? -1 : 1))
}

function pad4(length: number): number {
  return (length + 3) & ~3
}

/** Builds a minimal but valid sfnt (TrueType or OpenType) carrying the given name facts. */
export function buildSfnt(options: FontBuilderOptions, format: 'ttf' | 'otf' = 'ttf'): ArrayBuffer {
  const tables = fontTables(options)
  const directorySize = 12 + tables.length * 16
  const directory = new DataView(new ArrayBuffer(directorySize))
  directory.setUint32(0, format === 'ttf' ? 0x00010000 : 0x4f54544f) // magic ('OTTO' for CFF)
  directory.setUint16(4, tables.length)
  const bodies: Uint8Array[] = []
  let offset = directorySize
  tables.forEach((table, index) => {
    const at = 12 + index * 16
    for (let i = 0; i < 4; i++) directory.setUint8(at + i, table.tag.charCodeAt(i))
    directory.setUint32(at + 8, offset)
    directory.setUint32(at + 12, table.data.length)
    bodies.push(table.data)
    const padding = pad4(table.data.length) - table.data.length
    if (padding > 0) bodies.push(new Uint8Array(padding))
    offset += pad4(table.data.length)
  })
  return concat(new Uint8Array(directory.buffer), ...bodies).buffer
}

const WOFF_HEADER = 44
const WOFF_ENTRY = 20

/** Builds a WOFF wrapper around the same tables; each table is zlib-deflated when that shrinks it. */
export function buildWoff(options: FontBuilderOptions, compressed = true): ArrayBuffer {
  const tables = fontTables(options)
  const entriesData = new DataView(new ArrayBuffer(tables.length * WOFF_ENTRY))
  const bodies: Uint8Array[] = []
  let offset = WOFF_HEADER + tables.length * WOFF_ENTRY
  let totalSfntSize = 12 + tables.length * 16
  tables.forEach((table, index) => {
    const at = index * WOFF_ENTRY
    for (let i = 0; i < 4; i++) entriesData.setUint8(at + i, table.tag.charCodeAt(i))
    const shrunk = compressed ? deflateSync(table.data) : table.data
    const stored = shrunk.length < table.data.length ? shrunk : table.data
    entriesData.setUint32(at + 4, offset)
    entriesData.setUint32(at + 8, stored.length)
    entriesData.setUint32(at + 12, table.data.length)
    bodies.push(stored)
    offset += stored.length
    totalSfntSize += pad4(table.data.length)
  })
  const header = new DataView(new ArrayBuffer(WOFF_HEADER))
  header.setUint32(0, 0x774f4646) // 'wOFF'
  header.setUint32(4, 0x00010000) // flavor: TrueType outlines
  header.setUint32(8, offset) // total file length
  header.setUint16(12, tables.length)
  header.setUint16(14, 0) // reserved
  header.setUint32(16, totalSfntSize)
  header.setUint32(20, 0x00010000) // font version
  return concat(new Uint8Array(header.buffer), new Uint8Array(entriesData.buffer), ...bodies).buffer
}

/** Wraps font bytes in a `File` the upload inputs accept. */
export function asFile(data: ArrayBuffer, name: string, type = 'font/ttf'): File {
  return new File([data], name, { type })
}
