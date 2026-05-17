export function parseAudioMetadata(data) {
  const marker = data.indexOf(Buffer.from([0xfe, 0xff]));

  if (marker === -1 || marker + 16 > data.length) {
    return null;
  }

  const metadata = {
    marker,
    channels: data.readUInt16LE(marker + 2),
    sampleRate: data.readUInt32LE(marker + 4),
    byteRate: data.readUInt32LE(marker + 8),
    blockAlign: data.readUInt16LE(marker + 12),
    bitDepth: data.readUInt16LE(marker + 14)
  };

  return isPlausibleAudioMetadata(metadata) ? metadata : null;
}

export function parseRawiInfo(data) {
  if (data.length < 0x3c || data.subarray(0, 4).toString("ascii") !== "RAWI") {
    return null;
  }

  return {
    sampleCount: data.readUInt32LE(0x08),
    sampleRate: data.readUInt32LE(0x0c),
    loopStartSample: data.readUInt32LE(0x10),
    loopEndSample: data.readUInt32LE(0x14),
    streamChunkBytes: data.readUInt32LE(0x38)
  };
}

export function extractExternalRawName(data) {
  let end = data.length - 1;

  while (end > 0 && data[end] === 0) {
    end -= 1;
  }

  let start = end;

  while (start > 0 && data[start - 1] >= 32 && data[start - 1] <= 126) {
    start -= 1;
  }

  return data.subarray(start, end + 1).toString("ascii").trim();
}

export function extractEmbeddedAudioData(data, metadata) {
  let offset = data.length >= 40 ? data.readUInt32LE(36) : 136;

  if (offset < metadata.marker || offset > data.length) {
    offset = 136;
  }

  return data.subarray(Math.min(offset, data.length));
}

export function createWav(rawData, metadata) {
  const bytesPerSample = Math.max(1, metadata.bitDepth / 8);
  const blockAlign = metadata.channels * bytesPerSample;
  const byteRate = metadata.sampleRate * blockAlign;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + rawData.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(metadata.channels, 22);
  header.writeUInt32LE(metadata.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(metadata.bitDepth, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(rawData.length, 40);

  return Buffer.concat([header, rawData]);
}

export function decodeSqueakStreamRaw(rawData, metadata, rawiInfo = null) {
  const bytesPerSample = getBytesPerSample(metadata);
  const decoded = rawiInfo?.streamChunkBytes
    ? interleavePlanarStereoChunks(rawData, rawiInfo.streamChunkBytes, bytesPerSample)
    : { data: rawData, pairs: 0 };
  const channels = rawiInfo?.streamChunkBytes ? 2 : Math.max(1, metadata.channels || 1);
  const expectedBytes = rawiInfo?.sampleCount ? rawiInfo.sampleCount * bytesPerSample * channels : 0;
  const outputData = expectedBytes > 0 && decoded.data.length > expectedBytes ? decoded.data.subarray(0, expectedBytes) : decoded.data;

  return {
    data: outputData,
    metadata: {
      ...metadata,
      sourceChannels: metadata.channels,
      channels,
      byteRate: metadata.sampleRate * bytesPerSample * channels,
      blockAlign: bytesPerSample * channels
    },
    layout: {
      kind: rawiInfo?.streamChunkBytes ? "rawi-planar-stereo-chunks" : "rawi-pcm",
      sampleCount: rawiInfo?.sampleCount ?? null,
      loopStartSample: rawiInfo?.loopStartSample ?? null,
      loopEndSample: rawiInfo?.loopEndSample ?? null,
      streamChunkBytes: rawiInfo?.streamChunkBytes ?? null,
      streamChunkPairs: decoded.pairs,
      inputBytes: rawData.length,
      expectedBytes: expectedBytes || null,
      outputBytes: outputData.length,
      trimmedBytes: Math.max(0, decoded.data.length - outputData.length),
      sourceChannels: metadata.channels,
      outputChannels: channels
    }
  };
}

function interleavePlanarStereoChunks(rawData, chunkBytes, bytesPerSample) {
  const alignedChunkBytes = alignDown(chunkBytes, bytesPerSample);

  if (alignedChunkBytes <= 0 || rawData.length < alignedChunkBytes * 2) {
    return { data: rawData, pairs: 0 };
  }

  const chunks = Math.ceil(rawData.length / alignedChunkBytes);
  const pairs = Math.ceil(chunks / 2);
  const outputSize = getInterleavedOutputSize(rawData.length, alignedChunkBytes, bytesPerSample);
  const output = Buffer.alloc(outputSize);
  let writeOffset = 0;

  for (let pair = 0; pair < pairs; pair += 1) {
    const leftStart = pair * alignedChunkBytes * 2;
    const rightStart = leftStart + alignedChunkBytes;
    const leftLength = Math.max(0, Math.min(alignedChunkBytes, rawData.length - leftStart));
    const rightLength = Math.max(0, Math.min(alignedChunkBytes, rawData.length - rightStart));
    const samples = Math.ceil(Math.max(leftLength, rightLength) / bytesPerSample);

    for (let sample = 0; sample < samples; sample += 1) {
      writeOffset = copySampleOrSilence(rawData, output, leftStart + sample * bytesPerSample, leftStart + leftLength, writeOffset, bytesPerSample);
      writeOffset = copySampleOrSilence(rawData, output, rightStart + sample * bytesPerSample, rightStart + rightLength, writeOffset, bytesPerSample);
    }
  }

  return { data: output, pairs };
}

function getInterleavedOutputSize(rawLength, chunkBytes, bytesPerSample) {
  let outputSize = 0;

  for (let pairOffset = 0; pairOffset < rawLength; pairOffset += chunkBytes * 2) {
    const leftLength = Math.max(0, Math.min(chunkBytes, rawLength - pairOffset));
    const rightLength = Math.max(0, Math.min(chunkBytes, rawLength - pairOffset - chunkBytes));
    outputSize += Math.ceil(Math.max(leftLength, rightLength) / bytesPerSample) * bytesPerSample * 2;
  }

  return outputSize;
}

function copySampleOrSilence(source, target, sourceOffset, sourceEnd, targetOffset, bytesPerSample) {
  if (sourceOffset + bytesPerSample <= sourceEnd) {
    source.copy(target, targetOffset, sourceOffset, sourceOffset + bytesPerSample);
  }

  return targetOffset + bytesPerSample;
}

function getBytesPerSample(metadata) {
  return Math.max(1, Math.floor((metadata.bitDepth || 8) / 8));
}

function alignDown(value, alignment) {
  return Math.max(0, value - (value % alignment));
}

function isPlausibleAudioMetadata(metadata) {
  if (metadata.channels < 1 || metadata.channels > 8) {
    return false;
  }

  if (metadata.sampleRate < 4000 || metadata.sampleRate > 192000) {
    return false;
  }

  if (![8, 16, 24, 32].includes(metadata.bitDepth)) {
    return false;
  }

  const bytesPerSample = metadata.bitDepth / 8;
  const expectedBlockAlign = metadata.channels * bytesPerSample;

  if (metadata.blockAlign !== expectedBlockAlign) {
    return false;
  }

  return metadata.byteRate === metadata.sampleRate * metadata.blockAlign;
}
