// @ts-nocheck
/* tslint:disable */
/* eslint-disable */
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
 * @interface Favorite
 */
export interface Favorite {
    /**
     * 
     * @type {string}
     * @memberof Favorite
     */
    favorite_item_id: string;
    /**
     * 
     * @type {string}
     * @memberof Favorite
     */
    favorite_type: string;
    /**
     * 
     * @type {string}
     * @memberof Favorite
     */
    user_id: string;
}

export function FavoriteFromJSON(json: any): Favorite {
    return FavoriteFromJSONTyped(json, false);
}

export function FavoriteFromJSONTyped(json: any, ignoreDiscriminator: boolean): Favorite {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'favorite_item_id': json['favorite_item_id'],
        'favorite_type': json['favorite_type'],
        'user_id': json['user_id'],
    };
}

export function FavoriteToJSON(value?: Favorite | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'favorite_item_id': value.favorite_item_id,
        'favorite_type': value.favorite_type,
        'user_id': value.user_id,
    };
}

