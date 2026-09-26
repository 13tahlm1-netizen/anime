/**
 * MPEG-TS -> AAC ADTS Demuxer 유틸리티
 * - Node.js 및 브라우저 환경 모두에서 동작 (TypedArray 기반)
 * - MPEG-2 Transport Stream(.ts)에서 H.264 등 비디오 패킷을 제거하고 순수 AAC ADTS 오디오 스트림만 추출
 */

export function isTsStream(data: Uint8Array): boolean {
  return data.length >= 188 && data[0] === 0x47;
}

export function isAacStream(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0xff && (data[1] & 0xf0) === 0xf0;
}

export function extractAacFromTs(tsData: Uint8Array): Uint8Array {
  const len = tsData.length;
  let audioPid = -1;
  let pmtPid = -1;

  // 1차 패스: PAT -> PMT -> Audio PID 식별
  for (let i = 0; i + 188 <= len; i += 188) {
    if (tsData[i] !== 0x47) continue;
    const pid = ((tsData[i + 1] & 0x1f) << 8) | tsData[i + 2];
    const payloadStart = (tsData[i + 1] & 0x40) !== 0;
    const adaptCtrl = (tsData[i + 3] >> 4) & 0x03;
    let payloadOffset = i + 4;
    if (adaptCtrl === 2) continue;
    if (adaptCtrl === 3) payloadOffset += 1 + tsData[payloadOffset];
    if (payloadOffset >= i + 188) continue;

    if (pid === 0 && payloadStart) {
      const pointer = tsData[payloadOffset];
      const tableStart = payloadOffset + 1 + pointer;
      if (tableStart + 12 < i + 188) {
        pmtPid = ((tsData[tableStart + 10] & 0x1f) << 8) | tsData[tableStart + 11];
      }
    } else if (pid === pmtPid && payloadStart) {
      const pointer = tsData[payloadOffset];
      const pmtIdx = payloadOffset + 1 + pointer;
      const sectionLen = ((tsData[pmtIdx + 1] & 0x0f) << 8) | tsData[pmtIdx + 2];
      const programInfoLen = ((tsData[pmtIdx + 8] & 0x0f) << 8) | tsData[pmtIdx + 9];
      let esIdx = pmtIdx + 12 + programInfoLen;
      const endEs = pmtIdx + 3 + sectionLen - 4;
      while (esIdx + 5 <= endEs && esIdx < i + 188) {
        const streamType = tsData[esIdx];
        const esPid = ((tsData[esIdx + 1] & 0x1f) << 8) | tsData[esIdx + 2];
        const esInfoLen = ((tsData[esIdx + 3] & 0x0f) << 8) | tsData[esIdx + 4];
        if (
          streamType === 0x0f || // ISO/IEC 13818-7 Audio with ADTS (AAC)
          streamType === 0x03 || // ISO/IEC 11172-3 Audio (MP3)
          streamType === 0x04 || // ISO/IEC 13818-3 Audio (MP3)
          streamType === 0x11    // ISO/IEC 14496-3 Audio with LATM (AAC)
        ) {
          audioPid = esPid;
          break;
        }
        esIdx += 5 + esInfoLen;
      }
    }
  }

  // PES 헤더 기반 오디오 PID 탐색 (fallback)
  if (audioPid === -1) {
    for (let i = 0; i + 188 <= len; i += 188) {
      if (tsData[i] !== 0x47) continue;
      const payloadStart = (tsData[i + 1] & 0x40) !== 0;
      if (!payloadStart) continue;
      const pid = ((tsData[i + 1] & 0x1f) << 8) | tsData[i + 2];
      if (pid === 0 || pid === pmtPid) continue;
      const adaptCtrl = (tsData[i + 3] >> 4) & 0x03;
      let offset = i + 4;
      if (adaptCtrl === 2) continue;
      if (adaptCtrl === 3) offset += 1 + tsData[offset];
      if (offset + 4 <= i + 188) {
        if (tsData[offset] === 0 && tsData[offset + 1] === 0 && tsData[offset + 2] === 1) {
          const streamId = tsData[offset + 3];
          if (streamId >= 0xc0 && streamId <= 0xdf) {
            audioPid = pid;
            break;
          }
        }
      }
    }
  }

  if (audioPid === -1) {
    return tsData; // Demux 불가 시 원본 반환
  }

  const chunks: Uint8Array[] = [];
  for (let i = 0; i + 188 <= len; i += 188) {
    if (tsData[i] !== 0x47) continue;
    const pid = ((tsData[i + 1] & 0x1f) << 8) | tsData[i + 2];
    if (pid !== audioPid) continue;

    const payloadStart = (tsData[i + 1] & 0x40) !== 0;
    const adaptCtrl = (tsData[i + 3] >> 4) & 0x03;
    let offset = i + 4;
    if (adaptCtrl === 2) continue;
    if (adaptCtrl === 3) offset += 1 + tsData[offset];
    if (offset >= i + 188) continue;

    if (payloadStart) {
      if (
        offset + 9 <= i + 188 &&
        tsData[offset] === 0 &&
        tsData[offset + 1] === 0 &&
        tsData[offset + 2] === 1
      ) {
        const pesHeaderDataLen = tsData[offset + 8];
        const aacStart = offset + 9 + pesHeaderDataLen;
        if (aacStart < i + 188) {
          chunks.push(tsData.subarray(aacStart, i + 188));
        }
      }
    } else {
      chunks.push(tsData.subarray(offset, i + 188));
    }
  }

  let totalBytes = 0;
  for (const c of chunks) totalBytes += c.length;
  if (totalBytes === 0) {
    return tsData;
  }

  const result = new Uint8Array(totalBytes);
  let cur = 0;
  for (const c of chunks) {
    result.set(c, cur);
    cur += c.length;
  }
  return result;
}
