/*
  Makes HTML calls
*/
"use strict";

function HttpClient(dom) {
    let that = this;
}

HttpClient.prototype = {

    // set the base tag of a DOM to specified URL.
    setBaseTag: function (url, dom) {
        if (dom != null) {
            let tags = Array.prototype.slice.apply(dom.getElementsByTagName("base"));
            if (0 < tags.length) {
                tags[0].setAttribute("href", url);
            } else {
                let baseTag = dom.createElement("base");
                baseTag.setAttribute("href", url);
                dom.getElementsByTagName("head")[0].appendChild(baseTag);
            }
        }
    },

    // called when HTTP call fails
    // override to change default behaviour
    onError: function (url, statusText, event) {
        alert("fetch of URL(" + url + ") failed.  Error: " + statusText);
    },

    // fetches html document from URL
    fetchHtml: function (url, onHtlmReceived) {
        let that = this;
        let xhr = new XMLHttpRequest();
        xhr.onload = function (event) { that.onLoadHtml(url, xhr, event, onHtlmReceived); };
        xhr.onerror = function (event) { that.onError(url, xhr.statusText, event); };
        xhr.open("GET", url);
        xhr.responseType = "document";
        that.sendRequest(xhr);
    },

    onLoadHtml: function (url, xhr, event, onHtlmReceived) {
        let that = this;
        if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                that.setBaseTag(url, xhr.responseXML);
                onHtlmReceived(url, xhr.responseXML);
            } else {
                that.onError(url, xhr.statusText, event);
            }
        }
    },

    // testing hook point.
    // override to replace the network call
    sendRequest: function(xhr) {
        xhr.send();
    },

    fetchChapters: function (chapters, onFinished) {
        let that = this;
        if (0 < chapters.length) {
            that.fetchHtml(chapters[chapters.length - 1].sourceUrl, function(url, dom) { that.onChapterFetched(chapters, dom, onFinished) });
        } else {
            onFinished();
        }
    },

    onChapterFetched: function(chapters, dom, onFinished) {
        let that = this;
        chapters.pop().rawDom = dom;
        that.fetchChapters(chapters, onFinished);
    }

    // ToDo: create a fetchBinary() function
}