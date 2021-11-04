const path = require('path')

const config = require('../../config.js')
const { logger: genericLogger } = require('../../logging')
const { getSegmentsDuration } = require('../../segmentDuration')
const TranscodingQueue = require('../../TranscodingQueue')
const models = require('../../models')
const DBManager = require('../../dbManager')
const fileManager = require('../../fileManager')

const SaveFileToIPFSConcurrencyLimit = 10

const ENABLE_IPFS_ADD_TRACKS = config.get('enableIPFSAddTracks')
/**
 * Upload track segment files and make avail - will later be associated with Audius track
 *
 * Also the logic used in /track_content_async route. Params are extracted to keys that are necessary for the job so that
 * we can pass this task into a worker queue.
 *
 * @param {Object} logContext the context of the request used to create a generic logger
 * @param {Object} requestProps more request specific context, NOT the req object from Express
 * @returns a success or error server response
 * @dev - Prune upload artifacts after successful and failed uploads. Make call without awaiting, and let async queue clean up.
 */
const handleTrackContentRoute = async ({ logContext }, requestProps) => {
  const logger = genericLogger.child(logContext)

  const routeTimeStart = Date.now()
  let codeBlockTimeStart
  const cnodeUserUUID = requestProps.session.cnodeUserUUID

  // Create track transcode and segments, and save all to disk
  let transcodedFilePath
  let segmentFilePaths
  try {
    codeBlockTimeStart = Date.now()

    const transcode = await Promise.all([
      TranscodingQueue.segment(requestProps.fileDir, requestProps.fileName, { logContext }),
      TranscodingQueue.transcode320(requestProps.fileDir, requestProps.fileName, { logContext })
    ])
    segmentFilePaths = transcode[0].filePaths
    transcodedFilePath = transcode[1].filePath

    logger.info(`Time taken in /track_content_async to re-encode track file: ${Date.now() - codeBlockTimeStart}ms for file ${requestProps.fileName}`)
  } catch (err) {
    // Prune upload artifacts
    fileManager.removeTrackFolder({ logContext }, requestProps.fileDir)

    throw new Error(err.toString())
  }

  // Save transcode and segment files (in parallel) to ipfs and retrieve multihashes
  codeBlockTimeStart = Date.now()
  const transcodeFileIPFSResp = await fileManager.saveFileToIPFSFromFS(
    { logContext: requestProps.logContext },
    requestProps.session.cnodeUserUUID,
    transcodedFilePath,
    ENABLE_IPFS_ADD_TRACKS
  )

  let segmentFileIPFSResps = []
  for (let i = 0; i < segmentFilePaths.length; i += SaveFileToIPFSConcurrencyLimit) {
    const segmentFilePathsSlice = segmentFilePaths.slice(i, i + SaveFileToIPFSConcurrencyLimit)

    const sliceResps = await Promise.all(segmentFilePathsSlice.map(async (segmentFilePath) => {
      const segmentAbsolutePath = path.join(requestProps.fileDir, 'segments', segmentFilePath)
      const { multihash, dstPath } = await fileManager.saveFileToIPFSFromFS(
        { logContext: requestProps.logContext },
        requestProps.session.cnodeUserUUID,
        segmentAbsolutePath,
        ENABLE_IPFS_ADD_TRACKS
      )
      return { multihash, srcPath: segmentFilePath, dstPath }
    }))

    segmentFileIPFSResps = segmentFileIPFSResps.concat(sliceResps)
  }
  logger.info(`Time taken in /track_content_async for saving transcode + segment files to IPFS: ${Date.now() - codeBlockTimeStart}ms for file ${requestProps.fileName}`)

  // Retrieve all segment durations as map(segment srcFilePath => segment duration)
  codeBlockTimeStart = Date.now()
  const segmentDurations = await getSegmentsDuration(requestProps.fileName, requestProps.fileDestination)
  logger.info(`Time taken in /track_content_async to get segment duration: ${Date.now() - codeBlockTimeStart}ms for file ${requestProps.fileName}`)

  // For all segments, build array of (segment multihash, segment duration)
  let trackSegments = segmentFileIPFSResps.map((segmentFileIPFSResp) => {
    return {
      multihash: segmentFileIPFSResp.multihash,
      duration: segmentDurations[segmentFileIPFSResp.srcPath]
    }
  })

  // exclude 0-length segments that are sometimes outputted by ffmpeg segmentation
  trackSegments = trackSegments.filter(trackSegment => trackSegment.duration)

  // error if there are no track segments
  if (!trackSegments || !trackSegments.length) {
    // Prune upload artifacts
    fileManager.removeTrackFolder({ logContext }, requestProps.fileDir)

    throw new Error('Track upload failed - no track segments')
  }

  // Record entries for transcode and segment files in DB
  codeBlockTimeStart = Date.now()
  const transaction = await models.sequelize.transaction()
  let transcodeFileUUID
  try {
    // Record transcode file entry in DB
    const createTranscodeFileQueryObj = {
      multihash: transcodeFileIPFSResp.multihash,
      sourceFile: requestProps.fileName,
      storagePath: transcodeFileIPFSResp.dstPath,
      type: 'copy320' // TODO - replace with models enum
    }
    const file = await DBManager.createNewDataRecord(createTranscodeFileQueryObj, cnodeUserUUID, models.File, transaction)
    transcodeFileUUID = file.fileUUID

    // Record all segment file entries in DB
    // Must be written sequentially to ensure clock values are correctly incremented and populated
    for (const { multihash, dstPath } of segmentFileIPFSResps) {
      const createSegmentFileQueryObj = {
        multihash,
        sourceFile: requestProps.fileName,
        storagePath: dstPath,
        type: 'track' // TODO - replace with models enum
      }
      await DBManager.createNewDataRecord(createSegmentFileQueryObj, cnodeUserUUID, models.File, transaction)
    }

    await transaction.commit()
  } catch (e) {
    await transaction.rollback()

    // Prune upload artifacts
    fileManager.removeTrackFolder({ logContext }, requestProps.fileDir)

    throw new Error(e.toString())
  }
  logger.info(`Time taken in /track_content_async for DB updates: ${Date.now() - codeBlockTimeStart}ms for file ${requestProps.fileName}`)

  // Prune upload artifacts after success
  fileManager.removeTrackFolder({ logContext }, requestProps.fileDir)

  logger.info(`Time taken in /track_content_async for full route: ${Date.now() - routeTimeStart}ms for file ${requestProps.fileName}`)
  return {
    transcodedTrackCID: transcodeFileIPFSResp.multihash,
    transcodedTrackUUID: transcodeFileUUID,
    track_segments: trackSegments,
    source_file: requestProps.fileName
  }
}

module.exports = {
  handleTrackContentRoute
}
