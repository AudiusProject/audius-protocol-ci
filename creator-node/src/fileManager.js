const path = require('path')
const fs = require('fs-extra')
const multer = require('multer')
const getUuid = require('uuid/v4')
const axios = require('axios')

const config = require('./config')
const Utils = require('./utils')
const { libs: audiusLibs } = require('@audius/sdk')
const LibsUtils = audiusLibs.Utils
const DiskManager = require('./diskManager')
const { logger: genericLogger } = require('./logging')
const { sendResponse, errorResponseBadRequest } = require('./apiHelpers')
const { findCIDInNetwork } = require('./utils')
const DecisionTree = require('./utils/decisionTree')
const asyncRetry = require('./utils/asyncRetry')

const MAX_AUDIO_FILE_SIZE = parseInt(config.get('maxAudioFileSizeBytes')) // Default = 250,000,000 bytes = 250MB
const MAX_MEMORY_FILE_SIZE = parseInt(config.get('maxMemoryFileSizeBytes')) // Default = 50,000,000 bytes = 50MB

const ALLOWED_UPLOAD_FILE_EXTENSIONS = config.get('allowedUploadFileExtensions') // default set in config.json
const AUDIO_MIME_TYPE_REGEX = /audio\/(.*)/

const EMPTY_FILE_CID = 'QmbFMke1KXqnYyBBWxB74N4c5SBnJMVAiMNRcGu6x1AwQH' // deterministic CID for a 0 byte, completely empty file

/**
 * Saves file to disk under /multihash name
 */
async function saveFileFromBufferToDisk(req, buffer, numRetries = 5) {
  // Make sure user has authenticated before saving file
  if (!req.session.cnodeUserUUID) {
    throw new Error('User must be authenticated to save a file')
  }

  const cid = await LibsUtils.fileHasher.generateNonImageCid(
    buffer,
    genericLogger.child(req.logContext)
  )

  // Write file to disk by cid for future retrieval
  const dstPath = DiskManager.computeFilePath(cid)
  await fs.writeFile(dstPath, buffer)

  // verify that the contents of the file match the file's cid
  try {
    const fileSize = (await fs.stat(dstPath)).size
    const fileIsEmpty = fileSize === 0
    // there is one case where an empty file could be valid, check for that CID explicitly
    if (fileIsEmpty && cid !== EMPTY_FILE_CID) {
      throw new Error(`File has no content, content length is 0: ${cid}`)
    }

    const expectedCID = await LibsUtils.fileHasher.generateNonImageCid(
      dstPath,
      genericLogger.child(req.logContext)
    )
    if (cid !== expectedCID) {
      // delete this file because the next time we run sync and we see it on disk, we'll assume we have it and it's correct
      throw new Error(
        `File contents don't match their expected CID. CID: ${cid} expected CID: ${expectedCID}`
      )
    }
  } catch (e) {
    await removeFile(dstPath)
    if (numRetries > 0) {
      return saveFileFromBufferToDisk(req, buffer, numRetries - 1)
    }
    throw new Error(
      `saveFileFromBufferToDisk - Error during content verification for multihash ${cid} ${e.message}`
    )
  }

  return { cid, dstPath }
}

/**
 * Store file copy by CID for future retrieval
 * @param {String} multihash CID which will be computed into a destination path to copy to
 * @param {String} srcPath path to content to copy
 * @param {Object} logContext
 * @returns the destination path of where the content was copied to
 */
async function copyMultihashToFs(multihash, srcPath, logContext) {
  const logger = genericLogger.child(logContext)
  const dstPath = DiskManager.computeFilePath(multihash)

  try {
    await fs.copyFile(srcPath, dstPath)
  } catch (e) {
    // if we see a ENOSPC error, log out the disk space and inode details from the system
    if (e.message.includes('ENOSPC')) {
      await Promise.all([
        Utils.runShellCommand(`df`, ['-h'], logger),
        Utils.runShellCommand(`df`, ['-ih'], logger)
      ])
    }
    throw e
  }

  return dstPath
}

/**
 * Fetches a file from target gateway content routes (e.g. Content Node routes with /ipfs/<cid>)
 * @param {Object} param
 * @param {string} param.targetGatewayContentRoutes Content Node routes with /ipfs/<cid>
 * @param {number} param.trackId the observed track id
 * @param {number} param.numRetries the number of retries to attempt fetching content
 * @param {Object} param.logger
 * @param {Object} param.decisionTree
 * @returns the Stream data for the content, or null
 */
async function fetchFileFromTargetGateway({
  targetGatewayContentRoutes,
  trackId,
  numRetries,
  logger,
  decisionTree
}) {
  // First try to fetch from other cnode gateways if user has non-empty replica set.
  decisionTree.recordStage({
    name: 'About to race requests via gateways',
    data: { targetGatewayContentRoutes }
  })

  // Note - Requests are intentionally not parallel to minimize additional load on gateways
  for (const contentUrl of targetGatewayContentRoutes) {
    decisionTree.recordStage({
      name: 'Fetching from target gateways',
      data: { replicaUrl: contentUrl }
    })

    try {
      const streamData = await asyncRetry({
        asyncFn: fetchContentFn({ contentUrl, trackId }),
        logger,
        logLabel: 'fetchContentFromTargetGateway',
        options: {
          retries: numRetries,
          minTimeout: 3000
        }
      })

      decisionTree.recordStage({
        name: 'Retrieved file from target gateway',
        data: { url: contentUrl }
      })

      return streamData
    } catch (e) {
      decisionTree.recordStage({
        name: 'Error - Could not retrieve file from target gateway',
        data: {
          url: contentUrl,
          errorMsg: e.message,
          statusCode: e.response?.status
        }
      })
    }
  }

  return null
}

/**
 * Writes the stream data to disk with retries
 * @param {Object} param
 * @param {Stream} param.streamData the stream to write to disk
 * @param {string} param.path the path to write the stream data to
 * @param {Object} param.decisionTree
 * @param {Object} param.logger
 * @param {number} param.numRetries number of retries
 */
async function writeToDisk({
  streamData,
  path,
  decisionTree,
  logger,
  numRetries
}) {
  try {
    await asyncRetry({
      asyncFn: async () => {
        try {
          await Utils.writeStreamToFileSystem(streamData, path)

          decisionTree.recordStage({
            name: 'Wrote file to file system after fetching from target gateway',
            data: { expectedStoragePath: path }
          })
        } catch (e) {
          logger.error(
            `Could not write file to fs at path=${path}: ${e.message}. Removing file..`
          )

          // Note: this fn may throw if file does not exist on disk. This is okay as this flow will retry
          await removeFile(path)
        }
      },
      logger,
      logLabel: 'fetchContentFromTargetGateway',
      options: {
        retries: numRetries,
        minTimeout: 3000
      }
    })
  } catch (e) {
    decisionTree.recordStage({
      name: 'Error - Could not write file to fs',
      data: {
        errorMsg: e.message
      }
    })
  }
}

function fetchContentFn({ contentUrl, trackId }) {
  return async (bail) => {
    let response
    try {
      const fetchReqParams = {
        method: 'get',
        url: contentUrl,
        responseType: 'stream',
        timeout: 20000 /* 20 sec - higher timeout to allow enough time to fetch copy320 */
      }

      if (trackId) {
        fetchReqParams.params = {
          trackId
        }
      }

      response = await axios(fetchReqParams)
    } catch (e) {
      // Do not retry fetching content if content is delisted or request is bad
      if (
        e.response?.status === 403 || // delist
        e.response?.status === 401 || // unauth
        e.response?.status === 400 // bad request
      ) {
        bail(
          new Error(
            `Content is delisted, request is unauthorized, or the request is bad with statusCode=${e.response?.status}`
          )
        )
        return
      }

      throw new Error(
        `Failed to fetch with statusCode=${e.response?.status}. Retrying..`
      )
    }

    if (!response || !response.data) {
      throw new Error(`Received empty response`)
    }

    return response.data
  }
}

/**
 * Given a CID, saves the file to disk. Steps to achieve that:
 * 1. do the prep work to save the file to the local file system including
 *    creating directories
 * 2. attempt to fetch the CID from a variety of sources
 * 3. return boolean failure content retrieval or content verification failure
 * @param {Object} libs
 * @param {Object} logger
 * @param {String} multihash CID
 * @param {String} expectedStoragePath file system path similar to `/file_storage/Qm1`
 *                  for non dir files and `/file_storage/Qmdir/Qm2` for dir files
 * @param {Array} targetGateways List of gateway endpoints to try. May be all the registered Content Nodes, or just the user replica set.
 * @param {String?} fileNameForImage file name if the CID is image in dir.
 *                  eg original.jpg or 150x150.jpg
 * @param {number?} trackId if the CID is of a segment type, the trackId to which it belongs to
 * @param {number?} numRetries optional number of times to retry this function if there was an error during content verification
 * @return {Error?} error object or null
 */
async function saveFileForMultihashToFS(
  libs,
  logger,
  multihash,
  expectedStoragePath,
  targetGateways,
  fileNameForImage = null,
  trackId = null,
  numRetries = 3
) {
  const decisionTree = new DecisionTree({
    name: `saveFileForMultihashToFS() [multihash: ${multihash}]`,
    logger
  })

  try {
    // will be modified to directory compatible route later if directory
    // TODO - don't concat url's by hand like this, use module like urljoin
    // ..replace(/\/$/, "") removes trailing slashes

    let targetGatewayContentRoutes = targetGateways.map((endpoint) => {
      let baseUrl = `${endpoint.replace(/\/$/, '')}/ipfs/${multihash}`
      if (trackId) baseUrl += `?trackId=${trackId}`

      return baseUrl
    })

    const parsedStoragePath = path.parse(expectedStoragePath).dir

    decisionTree.recordStage({
      name: 'About to start running saveFileForMultihashToFS()',
      data: {
        multihash,
        targetGateways,
        targetGatewayContentRoutes,
        expectedStoragePath,
        parsedStoragePath
      },
      log: true
    })

    // Create dir at expected storage path in which to store retrieved data
    try {
      // calling this on an existing directory doesn't overwrite the existing data or throw an error
      // the mkdir recursive is equivalent to `mkdir -p`
      await fs.mkdir(parsedStoragePath, { recursive: true })
      decisionTree.recordStage({
        name: 'Successfully called mkdir on local file system',
        data: {
          parsedStoragePath
        }
      })
    } catch (e) {
      decisionTree.recordStage({
        name: 'Error calling mkdir on local file system',
        data: { parsedStoragePath }
      })
      throw new Error(
        `Error making directory at ${parsedStoragePath} - ${e.message}`
      )
    }

    // regex match to check if a directory or just a regular file
    // if directory will have both outer and inner properties in match.groups
    // else will have just outer
    const matchObj = DiskManager.extractCIDsFromFSPath(expectedStoragePath)

    // if this is a directory, make it compatible with our dir cid gateway url
    if (matchObj && matchObj.isDir && matchObj.outer && fileNameForImage) {
      // override gateway urls to make it compatible with directory given an endpoint
      // eg. before running the line below gatewayUrlsMapped looks like [https://endpoint.co/ipfs/Qm111, https://endpoint.co/ipfs/Qm222 ...]
      // in the case of a directory, override the gatewayUrlsMapped array to look like
      // [https://endpoint.co/ipfs/Qm111/150x150.jpg, https://endpoint.co/ipfs/Qm222/150x150.jpg ...]
      // ..replace(/\/$/, "") removes trailing slashes
      targetGatewayContentRoutes = targetGateways.map(
        (endpoint) =>
          `${endpoint.replace(/\/$/, '')}/ipfs/${
            matchObj.outer
          }/${fileNameForImage}`
      )
      decisionTree.recordStage({
        name: 'Updated gatewayUrlsMapped',
        data: { targetGatewayContentRoutes }
      })
    }

    /**
     * Attempts to fetch CID:
     *  - If file already stored on disk, return immediately
     *  - If file not already stored, request from user's replica set gateways in parallel and write to disk if file exists
     *  - If file does not exist on user's replca set, try the network and write to disk if file exists
     */

    // if (await fs.pathExists(expectedStoragePath)) {
    //   decisionTree.recordStage({
    //     name: 'Success - File already stored on disk',
    //     data: { expectedStoragePath }
    //   })

    //   return
    // }

    const streamData = await fetchFileFromTargetGateway({
      targetGatewayContentRoutes,
      trackId,
      numRetries,
      logger,
      decisionTree
    })

    if (streamData) {
      await writeToDisk({ streamData, path: expectedStoragePath, decisionTree })
    } else {
      try {
        // If file is not found in replica set, check network (remaining registered nodes)
        // Function inherently writes to disk as well
        const found = await findCIDInNetwork(
          path,
          multihash,
          logger,
          libs,
          trackId,
          /** excludeList */ targetGateways,
          numRetries,
          /* verifyContent */ false // Will be verified later in this flow
        )

        if (!found) {
          throw new Error(
            `Failed to retrieve file for multihash ${multihash} after trying network`
          )
        }

        decisionTree.recordStage({
          name: 'Found file from network'
        })
      } catch (e) {
        decisionTree.recordStage({
          name: `Failed to find file from network and target gateways`,
          data: { errorMsg: e.message }
        })

        throw e
      }
    }

    try {
      await asyncRetry({
        asyncFn: verifyFile({ expectedStoragePath, decisionTree, multihash }),
        logger,
        logLabel: 'Saving fetched content to disk',
        options: {
          retries: numRetries
        }
      })
    } catch (e) {
      // On error, delete this file because the next time we run sync and we see it on disk, we'll assume we have it and it's correct
      await removeFile(expectedStoragePath)

      decisionTree.recordStage({
        name: `Error during content verification for multihash`
      })
      throw new Error(
        `Error during content verification for multihash ${multihash} ${e.message}`
      )
    }
  } catch (e) {
    decisionTree.recordStage({
      name: `Uncaught Error`,
      data: { errorMsg: e.message }
    })

    return e
  } finally {
    decisionTree.printTree()
  }

  // If no error, return nothing
}

// Verify that the contents of the file match the file's cid
function verifyFile({ expectedStoragePath, decisionTree, multihash }) {
  return async () => {
    const fileSize = (await fs.stat(expectedStoragePath)).size
    decisionTree.recordStage({
      name: 'About to verify the file contents for the CID',
      data: { multihash, fileSize }
    })

    const fileIsEmpty = fileSize === 0
    // there is one case where an empty file could be valid, check for that CID explicitly
    if (fileIsEmpty && multihash !== EMPTY_FILE_CID) {
      throw new Error(`File has no content, content length is 0: ${multihash}`)
    }

    const expectedCid = await LibsUtils.fileHasher.generateNonImageCid(
      expectedStoragePath
    )
    if (multihash !== expectedCid) {
      decisionTree.recordStage({
        name: "File contents don't match their expected CID",
        data: { expectedCid }
      })
      throw new Error(
        `File contents don't match their expected CID. CID: ${multihash} expected CID: ${expectedCid}`
      )
    }
    decisionTree.recordStage({
      name: 'Successfully verified the file contents for the CID',
      data: { multihash }
    })
  }
}

/**
 * Removes all upload artifacts for track from filesystem. After successful upload these artifacts
 *    are all redundant since all synced content is replicated outside the upload folder.
 * (1) Remove all files in requested fileDir
 * (2) Confirm the only subdirectory is 'fileDir/segments'
 * (3) Remove all files in 'fileDir/segments' - throw if any subdirectories found
 * (4) Remove 'fileDir/segments' and fileDir
 * @dev - Eventually this function execution should be moved off of main server process
 */
async function removeTrackFolder({ logContext }, fileDir) {
  const logger = genericLogger.child(logContext)
  try {
    logger.info(`Removing track folder at fileDir ${fileDir}...`)
    if (!fileDir) {
      throw new Error('Cannot remove null fileDir')
    }

    const fileDirInfo = await fs.lstat(fileDir)
    if (!fileDirInfo.isDirectory()) {
      throw new Error('Expected directory input')
    }

    // Remove all contents of track dir (process sequentially to limit cpu load)
    const files = await fs.readdir(fileDir)
    for (const file of files) {
      const curPath = path.join(fileDir, file)

      if ((await fs.lstat(curPath)).isDirectory()) {
        // Only the 'segments' subdirectory is expected
        if (file !== 'segments') {
          throw new Error(`Unexpected subdirectory in ${fileDir} - ${curPath}`)
        }

        // Delete each segment file inside /fileDir/segments/ (process sequentially to limit cpu load)
        const segmentFiles = await fs.readdir(curPath)
        for (const segmentFile of segmentFiles) {
          const curSegmentPath = path.join(curPath, segmentFile)

          // Throw if a subdirectory found in /fileDir/segments/
          if ((await fs.lstat(curSegmentPath)).isDirectory()) {
            throw new Error(
              `Unexpected subdirectory in segments ${fileDir} - ${curPath}`
            )
          }

          // Delete segment file
          await fs.unlink(curSegmentPath)
        }

        // Delete /fileDir/segments/ directory after all its contents have been deleted
        await fs.rmdir(curPath)
      } else {
        // Delete file inside /fileDir/
        logger.info(`Removing ${curPath}`)
        await fs.unlink(curPath)
      }
    }

    // Delete fileDir after all its contents have been deleted
    await fs.rmdir(fileDir)
    logger.info(`Removed track folder at fileDir ${fileDir}`)
    return null
  } catch (err) {
    logger.error(`Error removing ${fileDir}. ${err}`)
    return err
  }
}

const getRandomFileName = () => {
  return getUuid()
}

const getTmpTrackUploadArtifactsPathWithInputUUID = (fileName) => {
  return path.join(DiskManager.getTmpTrackUploadArtifactsPath(), fileName)
}

const getTmpSegmentsPath = (fileName) => {
  return path.join(
    DiskManager.getTmpTrackUploadArtifactsPath(),
    fileName,
    'segments'
  )
}

// Simple in-memory storage for metadata/generic files
const memoryStorage = multer.memoryStorage()
const upload = multer({
  limits: { fileSize: MAX_MEMORY_FILE_SIZE },
  storage: memoryStorage
})

// Simple temp storage for metadata/generic files
const tempDiskStorage = multer.diskStorage({})
const uploadTempDiskStorage = multer({
  limits: { fileSize: MAX_MEMORY_FILE_SIZE },
  storage: tempDiskStorage
})

// Custom on-disk storage for track files to prep for segmentation
const trackDiskStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    let fileName
    if (req.query.uuid) {
      // Use the file name provided in the headers during track hand off
      fileName = req.query.uuid
    } else {
      // Save file under randomly named folders to avoid collisions
      fileName = getRandomFileName()
    }

    const fileDir = getTmpTrackUploadArtifactsPathWithInputUUID(fileName)
    const segmentsDir = getTmpSegmentsPath(fileName)

    // create directories for original file and segments
    fs.mkdirSync(fileDir)
    fs.mkdirSync(segmentsDir)

    req.fileDir = fileDir
    const fileExtension = getFileExtension(file.originalname)
    req.fileNameNoExtension = fileName
    req.fileName = fileName + fileExtension

    req.logger.info(
      `Created track disk storage: ${req.fileDir}, ${req.fileName}`
    )
    cb(null, fileDir)
  },
  filename: function (req, file, cb) {
    cb(null, req.fileName)
  }
})

const trackFileUpload = multer({
  storage: trackDiskStorage,
  limits: { fileSize: MAX_AUDIO_FILE_SIZE },
  fileFilter: function (req, file, cb) {
    try {
      checkFileType(req.logger, {
        fileName: file.originalname,
        fileMimeType: file.mimetype
      })
      cb(null, true)
    } catch (e) {
      req.fileFilterError = e.message
      cb(e)
    }
  }
})

const handleTrackContentUpload = (req, res, next) => {
  trackFileUpload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        req.fileSizeError = err
      } else if (err instanceof multer.MulterError) {
        req.logger.error(`Multer error: ${err}`)
      } else {
        req.logger.error(`Content upload error: ${err}`)
      }
    }
    next()
  })
}

function getFileExtension(fileName) {
  return fileName.lastIndexOf('.') >= 0
    ? fileName.substr(fileName.lastIndexOf('.')).toLowerCase()
    : ''
}

/**
 * Checks the file type. Throws an error if not accepted.
 * @param {Object} logger the logger instance from the express request object
 * @param {Object} param
 * @param {string} param.fileName the file name
 * @param {string} param.fileMimeType the file type
 */
function checkFileType(logger, { fileName, fileMimeType }) {
  const fileExtension = getFileExtension(fileName).slice(1)
  // the function should call `cb` with a boolean to indicate if the file should be accepted
  if (
    ALLOWED_UPLOAD_FILE_EXTENSIONS.includes(fileExtension) &&
    AUDIO_MIME_TYPE_REGEX.test(fileMimeType)
  ) {
    logger.info(`Filetype: ${fileExtension}`)
    logger.info(`Mimetype: ${fileMimeType}`)
  } else {
    throw new Error(
      `File type not accepted. Must be one of [${ALLOWED_UPLOAD_FILE_EXTENSIONS}] with mime type matching ${AUDIO_MIME_TYPE_REGEX}, got file ${fileExtension} with mime ${fileMimeType}`
    )
  }
}

/**
 * Checks the file size. Throws an error if file is too big.
 * @param {number} fileSize file size in bytes
 */
function checkFileSize(fileSize) {
  if (fileSize > MAX_AUDIO_FILE_SIZE) {
    throw new Error(
      `File exceeded maximum size (${MAX_AUDIO_FILE_SIZE}): fileSize=${fileSize}`
    )
  }
}

/**
 * The middleware fn that checks file data existence, and calls `checkFileType` and `checkFileSize`.
 * @param {Object} req express request object
 * @param {string} req.filename the file name
 * @param {string} req.filemimetype the file type
 * @param {number} req.filesize file size in bytes
 * @param {Object} res express response object
 * @param {function} next callback to proceed to the next handler
 */
function checkFileMiddleware(req, res, next) {
  const {
    filename: fileName,
    filetype: fileMimeType,
    filesize: fileSize
  } = req.headers
  try {
    if (!fileName || !fileMimeType || !fileSize) {
      throw new Error(
        `Some/all file data not present: fileName=${fileName} fileType=${fileMimeType} fileSize=${fileSize}`
      )
    }
    checkFileType(req.logger, { fileName, fileMimeType })
    checkFileSize(fileSize)
  } catch (e) {
    return sendResponse(req, res, errorResponseBadRequest(e.message))
  }

  return next()
}

/**
 * Checks if the Content Node storage has reached the `maxStorageUsedPercent` defined in the config. `storagePathSize`
 * and `storagePathUsed` are values taken off of the Content Node monitoring system.
 * @param {Object} param
 * @param {number} param.storagePathSize size of total storage
 * @param {number} param.storagePathUsed size of used storage
 * @param {number} param.maxStorageUsedPercent max storage percentage allowed in a CNode
 * @returns {boolean} true if enough storage; false if storage is equal to or over `maxStorageUsedPercent`
 */
function hasEnoughStorageSpace({
  storagePathSize,
  storagePathUsed,
  maxStorageUsedPercent
}) {
  // If these values are not present, the Content Node did not initialize properly.
  if (
    storagePathSize === null ||
    storagePathSize === undefined ||
    storagePathUsed === null ||
    storagePathUsed === undefined
  ) {
    return false
  }

  return (100 * storagePathUsed) / storagePathSize < maxStorageUsedPercent
}

/**
 * Remove file from location on disk
 * @param {String} storagePath path on disk for file
 * @returns null if successfully removed file or throws error if didn't successfully remove file
 */
async function removeFile(storagePath) {
  try {
    await fs.unlink(storagePath)
  } catch (err) {
    const fileDoesntExistError = err && err.code === 'ENOENT'
    if (!fileDoesntExistError) throw err
  }
}

module.exports = {
  saveFileFromBufferToDisk,
  saveFileForMultihashToFS,
  removeTrackFolder,
  upload,
  uploadTempDiskStorage,
  trackFileUpload,
  handleTrackContentUpload,
  hasEnoughStorageSpace,
  getFileExtension,
  checkFileMiddleware,
  getTmpTrackUploadArtifactsPathWithInputUUID,
  getTmpSegmentsPath,
  copyMultihashToFs,
  EMPTY_FILE_CID
}
