const fs = require('fs')
const { Buffer } = require('ipfs-http-client')
const { promisify } = require('util')
const path = require('path')
const tus = require('tus-node-server')
const uuid = require('uuid/v4')

const config = require('../config.js')
const models = require('../models')
const {
  saveFileFromBufferToIPFSAndDisk,
  saveFileToIPFSFromFS,
  removeTrackFolder,
  handleTrackContentUpload,
  getFileExtension,
  checkFileMiddleware
} = require('../fileManager')
const {
  handleResponse,
  handleResponseWithHeartbeat,
  sendResponse,
  successResponse,
  errorResponseBadRequest,
  errorResponseServerError
} = require('../apiHelpers')
const { validateStateForImageDirCIDAndReturnFileUUID } = require('../utils')
const {
  authMiddleware,
  ensurePrimaryMiddleware,
  syncLockMiddleware,
  issueAndWaitForSecondarySyncRequests,
  ensureStorageMiddleware
} = require('../middlewares')
const TranscodingQueue = require('../TranscodingQueue')
const { getSegmentsDuration } = require('../segmentDuration')

const { getCID } = require('./files')
const { decode } = require('../hashids.js')
const RehydrateIpfsQueue = require('../RehydrateIpfsQueue')
const { FileProcessingQueue } = require('../FileProcessingQueue')
const DBManager = require('../dbManager')
const { generateListenTimestampAndSignature } = require('../apiSigning.js')
const DiskManager = require('../diskManager')

const ENABLE_IPFS_ADD_TRACKS = config.get('enableIPFSAddTracks')
const ENABLE_IPFS_ADD_METADATA = config.get('enableIPFSAddMetadata')

const readFile = promisify(fs.readFile)
const tmpTrackArtifactsPath = DiskManager.getTmpTrackUploadArtifactsPath()
// This is the path used for resumable track content uploads.
// It must be the same as the path of where the track file is uploaded.
// In our case, the route must be able to accept file path patterns like
//    <tmp artifacts path>/<random uuid 1>/<random uuid 2>.<file extension>
// hence the /*/* part of the route
// Reference: https://github.com/tus/tus-node-server#use-tus-node-server-as-express-middleware
const resumableUploadRoute = path.join(tmpTrackArtifactsPath, '*', '*')

// Structure: <uuid>.<file_extension>. e.g. 1234-1234-1234-1234.mp3
const getFileName = (req) => {
  return req.storedFolderName + '/' + req.storedFileName + getFileExtension(req.headers.filename)
}

const server = new tus.Server()
server.datastore = new tus.FileStore({
  // Has to be a path that exists
  path: tmpTrackArtifactsPath,
  // In the tus-node-server example, they set the file path using the 'path' key. However, in their package,
  // doing so strips off any forward slashes. The 'directory' key overrides any 'path' specified, so use
  // this key instead.
  directory: tmpTrackArtifactsPath,
  namingFunction: getFileName
})

/**
 * The helper method to do the resumable upload and chunking
 */
async function handleResumableUpload (req, res, next) {
  try {
    // Grab the file details off of the url
    const urlArr = req.originalUrl.split('/')
    const fileDir = (urlArr.slice(0, urlArr.length - 1)).join('/')
    const storedFileName = (urlArr.slice(urlArr.length - 1))[0]

    const resp = await server.handle.bind(server)(req, res, next)
    req.logger.error(`[handleResumableUpload] statusCode=${resp.statusCode}`)
    if (resp.statusCode > 299 || resp.statusCode < 200) {
      // TODO: add resp details
      throw new Error(`Unsuccessful upload creation. fileDir=${fileDir} fileName=${storedFileName}`)
    }

    // If the entire upload is done, add a transcode task to the worker queue
    if (parseInt(req.headers.filesize) === resp.getHeaders()['upload-offset']) {
      await FileProcessingQueue.addTranscodeTask(
        {
          logContext: req.logContext,
          req: {
            fileName: storedFileName,
            fileDir,
            fileDestination: fileDir,
            session: {
              cnodeUserUUID: req.session.cnodeUserUUID
            }
          }
        }
      )
    }
  } catch (e) {
    req.logger.error(`[handleResuambleUpload] Error - ${e.toString()}`)
    return sendResponse(req, res, errorResponseServerError(e.toString()))
  }
}

const SaveFileToIPFSConcurrencyLimit = 10

module.exports = function (app) {
  /**
   * Initiate an upload using resumable and chunking logic for a track
   */
  app.post('/track_content_upload', authMiddleware, ensurePrimaryMiddleware, ensureStorageMiddleware, syncLockMiddleware, checkFileMiddleware, async function (req, res, next) {
    // Use the tus-node-server package to handle track upload

    // Save file under randomly named folders to avoid collisions
    const randomFileName = uuid()
    const randomFolderName = uuid()
    // The new, random file name for the uploaded track
    req.storedFileName = randomFileName
    // The new, random folder name that holds the uploaded track
    req.storedFolderName = randomFolderName

    const fileDir = path.join(tmpTrackArtifactsPath, randomFolderName)

    try {
      // Create directories for original file and segments
      DiskManager.ensureDirPathExists(fileDir)
      DiskManager.ensureDirPathExists(fileDir + '/segments')

      req.logger.info(`Created track disk storage: ${fileDir}, ${randomFileName}`)
    } catch (e) {
      return sendResponse(req, res, errorResponseServerError(e.toString()))
    }

    // Initialize resumable upload flow; handles responding with errors if they arise
    await server.handle.bind(server)(req, res, next)
  })

  // Routes that handle the resumable upload HEAD and PATCH requests.
  // Note: due to package limitations, we must set the route to the directory of where the track is uploaded.
  // Consider forking off this repo and making the HEAD/PATCH URLs configurable in the future
  app.head(resumableUploadRoute, authMiddleware, ensurePrimaryMiddleware, ensureStorageMiddleware, syncLockMiddleware, handleResumableUpload)
  app.patch(resumableUploadRoute, authMiddleware, ensurePrimaryMiddleware, ensureStorageMiddleware, syncLockMiddleware, handleResumableUpload)

  /**
   * Add a track transcode task into the worker queue. If the track file is uploaded properly (not transcoded), return successResponse
   * @note this track content route is used in conjunction with the polling.
   */
  app.post('/track_content_async', authMiddleware, ensurePrimaryMiddleware, ensureStorageMiddleware, syncLockMiddleware, handleTrackContentUpload, handleResponse(async (req, res) => {
    if (req.fileSizeError || req.fileFilterError) {
      removeTrackFolder({ logContext: req.logContext }, req.fileDir)
      return errorResponseBadRequest(req.fileSizeError || req.fileFilterError)
    }

    await FileProcessingQueue.addTranscodeTask(
      {
        logContext: req.logContext,
        req: {
          fileName: req.fileName,
          fileDir: req.fileDir,
          fileDestination: req.file.destination,
          session: {
            cnodeUserUUID: req.session.cnodeUserUUID
          }
        }
      }
    )
    return successResponse({ uuid: req.logContext.requestID })
  }))

  /**
   * upload track segment files and make avail - will later be associated with Audius track
   * @dev - Prune upload artifacts after successful and failed uploads. Make call without awaiting, and let async queue clean up.
   */
  app.post('/track_content', authMiddleware, ensurePrimaryMiddleware, ensureStorageMiddleware, syncLockMiddleware, handleTrackContentUpload, handleResponseWithHeartbeat(async (req, res) => {
    if (req.fileSizeError) {
      // Prune upload artifacts
      removeTrackFolder(req, req.fileDir)

      return errorResponseBadRequest(req.fileSizeError)
    }
    if (req.fileFilterError) {
      // Prune upload artifacts
      removeTrackFolder(req, req.fileDir)

      return errorResponseBadRequest(req.fileFilterError)
    }

    const routeTimeStart = Date.now()
    let codeBlockTimeStart
    const cnodeUserUUID = req.session.cnodeUserUUID

    // Create track transcode and segments, and save all to disk
    let transcodedFilePath
    let segmentFilePaths
    try {
      codeBlockTimeStart = Date.now()

      const transcode = await Promise.all([
        TranscodingQueue.segment(req.fileDir, req.fileName, { logContext: req.logContext }),
        TranscodingQueue.transcode320(req.fileDir, req.fileName, { logContext: req.logContext })
      ])
      segmentFilePaths = transcode[0].filePaths
      transcodedFilePath = transcode[1].filePath

      req.logger.info(`Time taken in /track_content to re-encode track file: ${Date.now() - codeBlockTimeStart}ms for file ${req.fileName}`)
    } catch (err) {
      // Prune upload artifacts
      removeTrackFolder(req, req.fileDir)

      return errorResponseServerError(err)
    }

    // Save transcode and segment files (in parallel) to ipfs and retrieve multihashes
    codeBlockTimeStart = Date.now()
    const transcodeFileIPFSResp = await saveFileToIPFSFromFS({ logContext: req.logContext }, req.session.cnodeUserUUID, transcodedFilePath, ENABLE_IPFS_ADD_TRACKS)

    let segmentFileIPFSResps = []
    for (let i = 0; i < segmentFilePaths.length; i += SaveFileToIPFSConcurrencyLimit) {
      const segmentFilePathsSlice = segmentFilePaths.slice(i, i + SaveFileToIPFSConcurrencyLimit)

      const sliceResps = await Promise.all(segmentFilePathsSlice.map(async (segmentFilePath) => {
        const segmentAbsolutePath = path.join(req.fileDir, 'segments', segmentFilePath)
        const { multihash, dstPath } = await saveFileToIPFSFromFS({ logContext: req.logContext }, req.session.cnodeUserUUID, segmentAbsolutePath, ENABLE_IPFS_ADD_TRACKS)
        return { multihash, srcPath: segmentFilePath, dstPath }
      }))

      segmentFileIPFSResps = segmentFileIPFSResps.concat(sliceResps)
    }
    req.logger.info(`Time taken in /track_content for saving transcode + segment files to IPFS: ${Date.now() - codeBlockTimeStart}ms for file ${req.fileName}`)

    // Retrieve all segment durations as map(segment srcFilePath => segment duration)
    codeBlockTimeStart = Date.now()
    const segmentDurations = await getSegmentsDuration(req.fileName, req.file.destination)
    req.logger.info(`Time taken in /track_content to get segment duration: ${Date.now() - codeBlockTimeStart}ms for file ${req.fileName}`)

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
      removeTrackFolder(req, req.fileDir)

      return errorResponseServerError('Track upload failed - no track segments')
    }

    // Record entries for transcode and segment files in DB
    codeBlockTimeStart = Date.now()
    const transaction = await models.sequelize.transaction()
    let transcodeFileUUID
    try {
      // Record transcode file entry in DB
      const createTranscodeFileQueryObj = {
        multihash: transcodeFileIPFSResp.multihash,
        sourceFile: req.fileName,
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
          sourceFile: req.fileName,
          storagePath: dstPath,
          type: 'track' // TODO - replace with models enum
        }
        await DBManager.createNewDataRecord(createSegmentFileQueryObj, cnodeUserUUID, models.File, transaction)
      }

      await transaction.commit()
    } catch (e) {
      await transaction.rollback()

      // Prune upload artifacts
      removeTrackFolder(req, req.fileDir)

      return errorResponseServerError(e)
    }
    req.logger.info(`Time taken in /track_content for DB updates: ${Date.now() - codeBlockTimeStart}ms for file ${req.fileName}`)

    // Prune upload artifacts after success
    removeTrackFolder(req, req.fileDir)

    req.logger.info(`Time taken in /track_content for full route: ${Date.now() - routeTimeStart}ms for file ${req.fileName}`)
    return successResponse({
      'transcodedTrackCID': transcodeFileIPFSResp.multihash,
      'transcodedTrackUUID': transcodeFileUUID,
      'track_segments': trackSegments,
      'source_file': req.fileName
    })
  }))

  /**
   * Given track metadata object, upload and share metadata to IPFS. Return metadata multihash if successful.
   * Error if associated track segments have not already been created and stored.
   */
  app.post('/tracks/metadata', authMiddleware, ensurePrimaryMiddleware, ensureStorageMiddleware, syncLockMiddleware, handleResponse(async (req, res) => {
    const metadataJSON = req.body.metadata

    if (
      !metadataJSON ||
      !metadataJSON.owner_id ||
      !metadataJSON.track_segments ||
      !Array.isArray(metadataJSON.track_segments) ||
      !metadataJSON.track_segments.length
    ) {
      return errorResponseBadRequest('Metadata object must include owner_id and non-empty track_segments array')
    }

    // If metadata indicates track is downloadable but doesn't provide a transcode CID,
    //    ensure that a transcoded master record exists in DB
    if (metadataJSON.download && metadataJSON.download.is_downloadable && !metadataJSON.download.cid) {
      let sourceFile = req.body.sourceFile
      const trackId = metadataJSON.track_id
      if (!sourceFile && !trackId) {
        return errorResponseBadRequest('Cannot make downloadable - A sourceFile must be provided or the metadata object must include track_id')
      }

      // See if the track already has a transcoded master
      if (trackId) {
        const { blockchainId } = await models.Track.findOne({
          attributes: ['blockchainId'],
          where: {
            blockchainId: trackId
          },
          order: [['clock', 'DESC']]
        })

        // Error if no DB entry for transcode found
        const transcodedFile = await models.File.findOne({
          attributes: ['multihash'],
          where: {
            cnodeUserUUID: req.session.cnodeUserUUID,
            type: 'copy320',
            trackBlockchainId: blockchainId
          }
        })
        if (!transcodedFile) {
          return errorResponseServerError('Failed to find transcoded file')
        }
      }
    }

    const metadataBuffer = Buffer.from(JSON.stringify(metadataJSON))
    const cnodeUserUUID = req.session.cnodeUserUUID

    // Save file from buffer to IPFS and disk
    let multihash, dstPath
    try {
      const resp = await saveFileFromBufferToIPFSAndDisk(req, metadataBuffer, ENABLE_IPFS_ADD_METADATA)
      multihash = resp.multihash
      dstPath = resp.dstPath
    } catch (e) {
      return errorResponseServerError(`/tracks/metadata saveFileFromBufferToIPFSAndDisk op failed: ${e}`)
    }

    // Record metadata file entry in DB
    const transaction = await models.sequelize.transaction()
    let fileUUID
    try {
      const createFileQueryObj = {
        multihash,
        sourceFile: req.fileName,
        storagePath: dstPath,
        type: 'metadata' // TODO - replace with models enum
      }
      const file = await DBManager.createNewDataRecord(createFileQueryObj, cnodeUserUUID, models.File, transaction)
      fileUUID = file.fileUUID

      await transaction.commit()
    } catch (e) {
      await transaction.rollback()
      return errorResponseServerError(`Could not save to db db: ${e}`)
    }

    return successResponse({
      'metadataMultihash': multihash,
      'metadataFileUUID': fileUUID
    })
  }))

  /**
   * Given track blockchainTrackId, blockNumber, and metadataFileUUID, creates/updates Track DB track entry
   * and associates segment & image file entries with track. Ends track creation/update process.
   */
  app.post('/tracks', authMiddleware, ensurePrimaryMiddleware, ensureStorageMiddleware, syncLockMiddleware, handleResponse(async (req, res) => {
    const { blockchainTrackId, blockNumber, metadataFileUUID, transcodedTrackUUID } = req.body

    // Input validation
    if (!blockchainTrackId || !blockNumber || !metadataFileUUID) {
      return errorResponseBadRequest('Must include blockchainTrackId, blockNumber, and metadataFileUUID.')
    }

    // Error on outdated blocknumber
    const cnodeUser = req.session.cnodeUser
    if (blockNumber < cnodeUser.latestBlockNumber) {
      return errorResponseBadRequest(
        `Invalid blockNumber param ${blockNumber}. Must be greater or equal to previously processed blocknumber ${cnodeUser.latestBlockNumber}.`
      )
    }
    const cnodeUserUUID = req.session.cnodeUserUUID

    // Fetch metadataJSON for metadataFileUUID, error if not found or malformatted
    const file = await models.File.findOne({ where: { fileUUID: metadataFileUUID, cnodeUserUUID } })
    if (!file) {
      return errorResponseBadRequest(`No file db record found for provided metadataFileUUID ${metadataFileUUID}.`)
    }
    let metadataJSON
    try {
      const fileBuffer = await readFile(file.storagePath)
      metadataJSON = JSON.parse(fileBuffer)
      if (
        !metadataJSON ||
        !metadataJSON.track_segments ||
        !Array.isArray(metadataJSON.track_segments) ||
        !metadataJSON.track_segments.length
      ) {
        return errorResponseServerError(`Malformatted metadataJSON stored for metadataFileUUID ${metadataFileUUID}.`)
      }
    } catch (e) {
      return errorResponseServerError(`No file stored on disk for metadataFileUUID ${metadataFileUUID} at storagePath ${file.storagePath}.`)
    }

    // Get coverArtFileUUID for multihash in metadata object, else error
    let coverArtFileUUID
    try {
      coverArtFileUUID = await validateStateForImageDirCIDAndReturnFileUUID(req, metadataJSON.cover_art_sizes)
    } catch (e) {
      return errorResponseServerError(e.message)
    }

    const transaction = await models.sequelize.transaction()
    try {
      const existingTrackEntry = await models.Track.findOne({
        where: {
          cnodeUserUUID,
          blockchainId: blockchainTrackId
        },
        order: [['clock', 'DESC']],
        transaction
      })

      // Insert track entry in DB
      const createTrackQueryObj = {
        metadataFileUUID,
        metadataJSON,
        blockchainId: blockchainTrackId,
        coverArtFileUUID
      }
      const track = await DBManager.createNewDataRecord(createTrackQueryObj, cnodeUserUUID, models.Track, transaction)

      /**
       * Associate matching transcode & segment files on DB with new/updated track
       * Must be done in same transaction to atomicity
       *
       * TODO - consider implications of edge-case -> two attempted /track_content before associate
       */

      const trackSegmentCIDs = metadataJSON.track_segments.map(segment => segment.multihash)

      // if track created, ensure files exist with trackBlockchainId = null and update them
      if (!existingTrackEntry) {
        // Associate the transcode file db record with trackUUID
        if (transcodedTrackUUID) {
          const transcodedFile = await models.File.findOne({
            where: {
              fileUUID: transcodedTrackUUID,
              cnodeUserUUID,
              trackBlockchainId: null,
              type: 'copy320'
            },
            transaction
          })
          if (!transcodedFile) {
            throw new Error('Did not find a transcoded file for the provided CID.')
          }
          const numAffectedRows = await models.File.update(
            { trackBlockchainId: track.blockchainId },
            { where: {
              fileUUID: transcodedTrackUUID,
              cnodeUserUUID,
              trackBlockchainId: null,
              type: 'copy320' // TODO - replace with model enum
            },
            transaction
            }
          )
          if (numAffectedRows === 0) {
            throw new Error('Failed to associate the transcoded file for the provided track UUID.')
          }
        }

        // Associate all segment file db records with trackUUID
        const trackFiles = await models.File.findAll({
          where: {
            multihash: trackSegmentCIDs,
            cnodeUserUUID,
            trackBlockchainId: null,
            type: 'track'
          },
          transaction
        })

        if (trackFiles.length < trackSegmentCIDs.length) {
          req.logger.error(`Did not find files for every track segment CID for user ${cnodeUserUUID} ${trackFiles} ${trackSegmentCIDs}`)
          throw new Error('Did not find files for every track segment CID.')
        }
        const numAffectedRows = await models.File.update(
          { trackBlockchainId: track.blockchainId },
          {
            where: {
              multihash: trackSegmentCIDs,
              cnodeUserUUID,
              trackBlockchainId: null,
              type: 'track'
            },
            transaction
          }
        )
        if (parseInt(numAffectedRows, 10) < trackSegmentCIDs.length) {
          req.logger.error(`Failed to associate files for every track segment CID ${cnodeUserUUID} ${track.blockchainId} ${numAffectedRows} ${trackSegmentCIDs.length}`)
          throw new Error('Failed to associate files for every track segment CID.')
        }
      } else { /** If track updated, ensure files exist with trackBlockchainId. */
        // Ensure transcode file db record exists if uuid provided
        if (transcodedTrackUUID) {
          const transcodedFile = await models.File.findOne({
            where: {
              fileUUID: transcodedTrackUUID,
              cnodeUserUUID,
              trackBlockchainId: track.blockchainId,
              type: 'copy320'
            },
            transaction
          })
          if (!transcodedFile) {
            throw new Error('Did not find the corresponding transcoded file for the provided track UUID.')
          }
        }

        // Ensure segment file db records exist for all CIDs
        const trackFiles = await models.File.findAll({
          where: {
            multihash: trackSegmentCIDs,
            cnodeUserUUID,
            trackBlockchainId: track.blockchainId,
            type: 'track'
          },
          transaction
        })
        if (trackFiles.length < trackSegmentCIDs.length) {
          throw new Error('Did not find files for every track segment CID with trackBlockchainId.')
        }
      }

      // Update cnodeUser's latestBlockNumber if higher than previous latestBlockNumber.
      // TODO - move to subquery to guarantee atomicity.
      const updatedCNodeUser = await models.CNodeUser.findOne({ where: { cnodeUserUUID }, transaction })
      if (!updatedCNodeUser || !updatedCNodeUser.latestBlockNumber) {
        throw new Error('Issue in retrieving udpatedCnodeUser')
      }
      req.logger.info(
        `cnodeuser ${cnodeUserUUID} first latestBlockNumber ${cnodeUser.latestBlockNumber} || \
        current latestBlockNumber ${updatedCNodeUser.latestBlockNumber} || \
        given blockNumber ${blockNumber}`
      )
      if (blockNumber > updatedCNodeUser.latestBlockNumber) {
        // Update cnodeUser's latestBlockNumber
        await cnodeUser.update({ latestBlockNumber: blockNumber }, { transaction })
      }

      await transaction.commit()

      await issueAndWaitForSecondarySyncRequests(req)

      return successResponse()
    } catch (e) {
      req.logger.error(e.message)
      await transaction.rollback()
      return errorResponseServerError(e.message)
    }
  }))

  /** Returns download status of track and 320kbps CID if ready + downloadable. */
  app.get('/tracks/download_status/:blockchainId', handleResponse(async (req, res) => {
    const blockchainId = req.params.blockchainId
    if (!blockchainId) {
      return errorResponseBadRequest('Please provide blockchainId.')
    }

    const track = await models.Track.findOne({
      where: { blockchainId },
      order: [['clock', 'DESC']]
    })
    if (!track) {
      return errorResponseBadRequest(`No track found for blockchainId ${blockchainId}`)
    }

    // Case: track is not marked as downloadable
    if (!track.metadataJSON || !track.metadataJSON.download || !track.metadataJSON.download.is_downloadable) {
      return successResponse({ isDownloadable: false, cid: null })
    }

    // Case: track is marked as downloadable
    // - Check if downloadable file exists. Since copyFile may or may not have trackBlockchainId association,
    //    fetch a segmentFile for trackBlockchainId, and find copyFile for segmentFile's sourceFile.
    const segmentFile = await models.File.findOne({ where: {
      type: 'track',
      trackBlockchainId: track.blockchainId
    } })
    const copyFile = await models.File.findOne({ where: {
      type: 'copy320',
      sourceFile: segmentFile.sourceFile
    } })
    if (!copyFile) {
      return successResponse({ isDownloadable: true, cid: null })
    }

    // Asynchronously rehydrate and return CID. If file is not in ipfs, serve from FS
    try {
      // Rehydrate master copy if necessary
      RehydrateIpfsQueue.addRehydrateIpfsFromFsIfNecessaryTask(copyFile.multihash, copyFile.storagePath, { logContext: req.logContext })

      return successResponse({ isDownloadable: true, cid: copyFile.multihash })
    } catch (e) {
      return successResponse({ isDownloadable: true, cid: null })
    }
  }))

  /**
   * Gets a streamable mp3 link for a track by encodedId. Supports range request headers.
   * @dev - Wrapper around getCID, which retrieves track given its CID.
   **/
  app.get('/tracks/stream/:encodedId', async (req, res, next) => {
    const libs = req.app.get('audiusLibs')
    const redisClient = req.app.get('redisClient')
    const delegateOwnerWallet = config.get('delegateOwnerWallet')

    const encodedId = req.params.encodedId
    if (!encodedId) {
      return sendResponse(req, res, errorResponseBadRequest('Please provide a track ID'))
    }

    const blockchainId = decode(encodedId)
    if (!blockchainId) {
      return sendResponse(req, res, errorResponseBadRequest(`Invalid ID: ${encodedId}`))
    }

    let fileRecord = await models.File.findOne({
      attributes: ['multihash'],
      where: {
        type: 'copy320',
        trackBlockchainId: blockchainId
      },
      order: [['clock', 'DESC']]
    })

    if (!fileRecord) {
      try {
        // see if there's a fileRecord in redis so we can short circuit all this logic
        let redisFileRecord = await redisClient.get(`streamFallback:::${blockchainId}`)
        if (redisFileRecord) {
          redisFileRecord = JSON.parse(redisFileRecord)
          if (redisFileRecord && redisFileRecord.multihash) {
            fileRecord = redisFileRecord
          }
        }
      } catch (e) {
        req.logger.error(`Error looking for stream fallback in redis`, e)
      }
    }

    // if track didn't finish the upload process and was never associated, there may not be a trackBlockchainId for the File records,
    // try to fall back to discovery to fetch the metadata multihash and see if you can deduce the copy320 file
    if (!fileRecord) {
      try {
        let trackRecord = await libs.Track.getTracks(1, 0, [blockchainId])
        if (!trackRecord || trackRecord.length === 0 || !trackRecord[0].hasOwnProperty('blocknumber')) {
          return sendResponse(req, res, errorResponseServerError('Missing or malformatted track fetched from discovery node.'))
        }

        trackRecord = trackRecord[0]

        // query the files table for a metadata multihash from discovery for a given track
        // no need to add CNodeUserUUID to the filter because the track is associated with a user and that contains the
        // user_id inside it which is unique to the user
        const file = await models.File.findOne({ where: { multihash: trackRecord.metadata_multihash, type: 'metadata' } })
        if (!file) {
          return sendResponse(req, res, errorResponseServerError('Missing or malformatted track fetched from discovery node.'))
        }

        // make sure all track segments have the same sourceFile
        const segments = trackRecord.track_segments.map(segment => segment.multihash)

        let fileSegmentRecords = await models.File.findAll({
          attributes: ['sourceFile'],
          where: {
            multihash: segments,
            cnodeUserUUID: file.cnodeUserUUID
          },
          raw: true
        })

        // check that the number of files in the Files table for these segments for this user matches the number of segments from the metadata object
        if (fileSegmentRecords.length !== trackRecord.track_segments.length) {
          req.logger.warn(`Track stream content mismatch for blockchainId ${blockchainId} - number of segments don't match between local and discovery`)
        }

        // check that there's a single sourceFile that all File records share by getting an array of uniques
        const uniqSourceFiles = fileSegmentRecords.map(record => record.sourceFile).filter((v, i, a) => a.indexOf(v) === i)

        if (uniqSourceFiles.length !== 1) {
          req.logger.warn(`Track stream content mismatch for blockchainId ${blockchainId} - there's not one sourceFile that matches all segments`)
        }

        // search for the copy320 record based on the sourceFile
        fileRecord = await models.File.findOne({
          attributes: ['multihash'],
          where: {
            type: 'copy320',
            sourceFile: uniqSourceFiles[0]
          },
          raw: true
        })

        // cache the fileRecord in redis for an hour so we don't have to keep making requests to discovery
        if (fileRecord) {
          redisClient.set(`streamFallback:::${blockchainId}`, JSON.stringify(fileRecord), 'EX', 60 * 60)
        }
      } catch (e) {
        req.logger.error(`Error falling back to reconstructing data from discovery to stream`, e)
      }
    }

    if (!fileRecord || !fileRecord.multihash) {
      return sendResponse(req, res, errorResponseBadRequest(`No file found for blockchainId ${blockchainId}`))
    }

    if (libs.identityService) {
      req.logger.info(`Logging listen for track ${blockchainId} by ${delegateOwnerWallet}`)
      const signatureData = generateListenTimestampAndSignature(
        config.get('delegatePrivateKey')
      )
      // Fire and forget listen recording
      // TODO: Consider queueing these requests
      libs.identityService.logTrackListen(
        blockchainId,
        delegateOwnerWallet,
        req.ip,
        signatureData
      )
    }

    req.params.CID = fileRecord.multihash
    req.params.streamable = true
    res.set('Content-Type', 'audio/mpeg')
    next()
  }, getCID)

  /**
   * List all unlisted tracks for a user
   */
  app.get('/tracks/unlisted', authMiddleware, handleResponse(async (req, res) => {
    const tracks = (await models.sequelize.query(
      `select "metadataJSON"->'title' as "title", "blockchainId" from (
        select "metadataJSON", "blockchainId", row_number() over (
          partition by "blockchainId" order by "clock" desc
        ) from "Tracks"
        where "cnodeUserUUID" = :cnodeUserUUID
        and ("metadataJSON"->>'is_unlisted')::boolean = true
      ) as a
      where a.row_number = 1;`,
      {
        replacements: { cnodeUserUUID: req.session.cnodeUserUUID }
      }
    ))[0]

    return successResponse({
      tracks: tracks.map(track => ({
        title: track.title,
        id: track.blockchainId
      }))
    })
  }))
}
