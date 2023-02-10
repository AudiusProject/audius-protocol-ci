/* tslint:disable */
// @ts-nocheck
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


import * as runtime from '../runtime';
import type {
  PlaylistResponse,
  PlaylistSearchResult,
  PlaylistTracksResponse,
  TrendingPlaylistsResponse,
} from '../models';
import {
    PlaylistResponseFromJSON,
    PlaylistResponseToJSON,
    PlaylistSearchResultFromJSON,
    PlaylistSearchResultToJSON,
    PlaylistTracksResponseFromJSON,
    PlaylistTracksResponseToJSON,
    TrendingPlaylistsResponseFromJSON,
    TrendingPlaylistsResponseToJSON,
} from '../models';

export interface GetPlaylistRequest {
    playlistId: string;
}

export interface GetPlaylistTracksRequest {
    playlistId: string;
}

export interface GetTrendingPlaylistsRequest {
    time?: GetTrendingPlaylistsTimeEnum;
}

export interface SearchPlaylistsRequest {
    query: string;
}

/**
 * 
 */
export class PlaylistsApi extends runtime.BaseAPI {

    /**
     * Get a playlist by ID
     */
    async getPlaylistRaw(requestParameters: GetPlaylistRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<PlaylistResponse>> {
        if (requestParameters.playlistId === null || requestParameters.playlistId === undefined) {
            throw new runtime.RequiredError('playlistId','Required parameter requestParameters.playlistId was null or undefined when calling getPlaylist.');
        }

        const queryParameters: any = {};

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/playlists/{playlist_id}`.replace(`{${"playlist_id"}}`, encodeURIComponent(String(requestParameters.playlistId))),
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => PlaylistResponseFromJSON(jsonValue));
    }

    /**
     * Get a playlist by ID
     */
    async getPlaylist(requestParameters: GetPlaylistRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<PlaylistResponse> {
        const response = await this.getPlaylistRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Fetch tracks within a playlist.
     */
    async getPlaylistTracksRaw(requestParameters: GetPlaylistTracksRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<PlaylistTracksResponse>> {
        if (requestParameters.playlistId === null || requestParameters.playlistId === undefined) {
            throw new runtime.RequiredError('playlistId','Required parameter requestParameters.playlistId was null or undefined when calling getPlaylistTracks.');
        }

        const queryParameters: any = {};

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/playlists/{playlist_id}/tracks`.replace(`{${"playlist_id"}}`, encodeURIComponent(String(requestParameters.playlistId))),
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => PlaylistTracksResponseFromJSON(jsonValue));
    }

    /**
     * Fetch tracks within a playlist.
     */
    async getPlaylistTracks(requestParameters: GetPlaylistTracksRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<PlaylistTracksResponse> {
        const response = await this.getPlaylistTracksRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Gets trending playlists for a time period
     */
    async getTrendingPlaylistsRaw(requestParameters: GetTrendingPlaylistsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<TrendingPlaylistsResponse>> {
        const queryParameters: any = {};

        if (requestParameters.time !== undefined) {
            queryParameters['time'] = requestParameters.time;
        }

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/playlists/trending`,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => TrendingPlaylistsResponseFromJSON(jsonValue));
    }

    /**
     * Gets trending playlists for a time period
     */
    async getTrendingPlaylists(requestParameters: GetTrendingPlaylistsRequest = {}, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<TrendingPlaylistsResponse> {
        const response = await this.getTrendingPlaylistsRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Search for a playlist
     */
    async searchPlaylistsRaw(requestParameters: SearchPlaylistsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<PlaylistSearchResult>> {
        if (requestParameters.query === null || requestParameters.query === undefined) {
            throw new runtime.RequiredError('query','Required parameter requestParameters.query was null or undefined when calling searchPlaylists.');
        }

        const queryParameters: any = {};

        if (requestParameters.query !== undefined) {
            queryParameters['query'] = requestParameters.query;
        }

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/playlists/search`,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => PlaylistSearchResultFromJSON(jsonValue));
    }

    /**
     * Search for a playlist
     */
    async searchPlaylists(requestParameters: SearchPlaylistsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<PlaylistSearchResult> {
        const response = await this.searchPlaylistsRaw(requestParameters, initOverrides);
        return await response.value();
    }

}

/**
 * @export
 */
export const GetTrendingPlaylistsTimeEnum = {
    Week: 'week',
    Month: 'month',
    Year: 'year',
    AllTime: 'allTime'
} as const;
export type GetTrendingPlaylistsTimeEnum = typeof GetTrendingPlaylistsTimeEnum[keyof typeof GetTrendingPlaylistsTimeEnum];
