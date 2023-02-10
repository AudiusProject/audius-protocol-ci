/* tslint:disable */
/* eslint-disable */
// @ts-nocheck
/**
 * API
 * No description provided (generated by Openapi Generator https://github.com/openapitools/openapi-generator)
 *
 * The version of the OpenAPI document: 1.0
 * 
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { exists, mapValues } from '../runtime';
/**
 * 
 * @export
 * @interface DownloadMetadata
 */
export interface DownloadMetadata {
    /**
     * 
     * @type {string}
     * @memberof DownloadMetadata
     */
    cid?: string;
    /**
     * 
     * @type {boolean}
     * @memberof DownloadMetadata
     */
    isDownloadable: boolean;
    /**
     * 
     * @type {boolean}
     * @memberof DownloadMetadata
     */
    requiresFollow: boolean;
}

/**
 * Check if a given object implements the DownloadMetadata interface.
 */
export function instanceOfDownloadMetadata(value: object): boolean {
    let isInstance = true;
    isInstance = isInstance && "isDownloadable" in value;
    isInstance = isInstance && "requiresFollow" in value;

    return isInstance;
}

export function DownloadMetadataFromJSON(json: any): DownloadMetadata {
    return DownloadMetadataFromJSONTyped(json, false);
}

export function DownloadMetadataFromJSONTyped(json: any, ignoreDiscriminator: boolean): DownloadMetadata {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'cid': !exists(json, 'cid') ? undefined : json['cid'],
        'isDownloadable': json['is_downloadable'],
        'requiresFollow': json['requires_follow'],
    };
}

export function DownloadMetadataToJSON(value?: DownloadMetadata | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'cid': value.cid,
        'is_downloadable': value.isDownloadable,
        'requires_follow': value.requiresFollow,
    };
}

