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


import { CoverPhoto } from './cover-photo';
import { PlaylistLibrary } from './playlist-library';
import { ProfilePicture } from './profile-picture';

/**
 * 
 * @export
 * @interface UserFull
 */
export interface UserFull {
    /**
     * 
     * @type {number}
     * @memberof UserFull
     */
    'album_count': number;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    'bio'?: string;
    /**
     * 
     * @type {CoverPhoto}
     * @memberof UserFull
     */
    'cover_photo'?: CoverPhoto;
    /**
     * 
     * @type {number}
     * @memberof UserFull
     */
    'followee_count': number;
    /**
     * 
     * @type {number}
     * @memberof UserFull
     */
    'follower_count': number;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    'handle': string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    'id': string;
    /**
     * 
     * @type {boolean}
     * @memberof UserFull
     */
    'is_verified': boolean;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    'location'?: string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    'name': string;
    /**
     * 
     * @type {number}
     * @memberof UserFull
     */
    'playlist_count': number;
    /**
     * 
     * @type {ProfilePicture}
     * @memberof UserFull
     */
    'profile_picture'?: ProfilePicture;
    /**
     * 
     * @type {number}
     * @memberof UserFull
     */
    'repost_count': number;
    /**
     * 
     * @type {number}
     * @memberof UserFull
     */
    'track_count': number;
    /**
     * 
     * @type {boolean}
     * @memberof UserFull
     */
    'is_deactivated': boolean;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    'balance': string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    'associated_wallets_balance': string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    'total_balance': string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    'associated_sol_wallets_balance': string;
    /**
     * 
     * @type {number}
     * @memberof UserFull
     */
    'blocknumber': number;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    'wallet': string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    'created_at': string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    'creator_node_endpoint'?: string;
    /**
     * 
     * @type {number}
     * @memberof UserFull
     */
    'current_user_followee_follow_count': number;
    /**
     * 
     * @type {boolean}
     * @memberof UserFull
     */
    'does_current_user_follow': boolean;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    'handle_lc': string;
    /**
     * 
     * @type {boolean}
     * @memberof UserFull
     */
    'is_creator': boolean;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    'updated_at': string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    'cover_photo_sizes'?: string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    'cover_photo_legacy'?: string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    'profile_picture_sizes'?: string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    'profile_picture_legacy'?: string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    'metadata_multihash'?: string;
    /**
     * 
     * @type {boolean}
     * @memberof UserFull
     */
    'has_collectibles': boolean;
    /**
     * 
     * @type {PlaylistLibrary}
     * @memberof UserFull
     */
    'playlist_library'?: PlaylistLibrary;
}

