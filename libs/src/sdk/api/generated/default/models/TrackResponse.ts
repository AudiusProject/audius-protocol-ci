// @ts-nocheck
/* tslint:disable */
/* eslint-disable */
/**
 * API
 * Audius V1 API
 *
 * The version of the OpenAPI document: 1.0
 * 
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { exists, mapValues } from '../runtime';
import {
    Track,
    TrackFromJSON,
    TrackFromJSONTyped,
    TrackToJSON,
} from './Track';

/**
 * 
 * @export
 * @interface TrackResponse
 */
export interface TrackResponse {
    /**
     * 
     * @type {Track}
     * @memberof TrackResponse
     */
    data?: Track;
}

export function TrackResponseFromJSON(json: any): TrackResponse {
    return TrackResponseFromJSONTyped(json, false);
}

export function TrackResponseFromJSONTyped(json: any, ignoreDiscriminator: boolean): TrackResponse {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'data': !exists(json, 'data') ? undefined : TrackFromJSON(json['data']),
    };
}

export function TrackResponseToJSON(value?: TrackResponse | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'data': TrackToJSON(value.data),
    };
}

