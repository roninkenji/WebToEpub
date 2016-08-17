/*
  Parses files on www.baka-tsuki.org
*/
"use strict";

class BakaTsukiParser extends Parser{
    constructor(imageCollector) {
        super();
        this.firstPageDom = null;
        this.imageCollector = imageCollector;
    }
}

parserFactory.register("www.baka-tsuki.org", function() { 
    return new BakaTsukiParser(new ImageCollector()) 
});

BakaTsukiParser.prototype.extractTitle = function(dom) {
    return this.getElement(dom, "h1", e => (e.className === "firstHeading") ).textContent.trim();
};

BakaTsukiParser.prototype.extractAuthor = function(dom) {
    // HTML doesn't have author.
    return "<Unknown>";
};

BakaTsukiParser.prototype.extractLanguage = function(dom) {
    return this.getElement(dom, "html").getAttribute("lang");
};

BakaTsukiParser.prototype.extractSeriesInfo = function(dom, metaInfo) {
    // assumes <title> element text is "<series name>:Volume <series index> - Baka Tsuki"
    let that = this;
    let title = util.getElement(dom, "title").innerText.trim();
    let splitIndex = title.indexOf(':');
    if (0 < splitIndex) {
        metaInfo.seriesName = title.substring(0, splitIndex);
        metaInfo.seriesIndex = that.extractVolumeIndex(title.substring(splitIndex));
    };
}

BakaTsukiParser.prototype.extractVolumeIndex = function(volumeString) {
    let volumeIndex = "";
    for(let ch of volumeString) {
        if (('0' <= ch) && (ch <= '9')) {
            volumeIndex += ch;
        };
    };    
    return volumeIndex;
}

// find the node(s) holding the story content
BakaTsukiParser.prototype.findContent = function (dom) {
    return this.getElement(dom, "div", e => (e.className === "mw-content-ltr") );
};

// called when plugin has obtained the first web page
BakaTsukiParser.prototype.onLoadFirstPage = function (url, firstPageDom) {
    let that = this;
    that.firstPageDom = firstPageDom;
        
    // ToDo: at moment is collecting images from inital web page at load time
    // when the popup UI is populated.  Will need to fetch correct images
    // as a separate step later
    that.imageCollector.findImagesUsedInDocument(that.findContent(firstPageDom));
    that.imageCollector.populateImageTable();
};

BakaTsukiParser.prototype.populateUI = function () {
    let that = this;
    document.getElementById("imageSection").hidden = false;
    document.getElementById("outputSection").hidden = true;
    document.getElementById("translatorRow").hidden = false;
    document.getElementById("fileAuthorAsRow").hidden = false;
    that.getFetchContentButton().onclick = (e => that.onFetchImagesClicked());
};

BakaTsukiParser.prototype.epubItemSupplier = function () {
    let that = this;
    let content = that.findContent(that.firstPageDom).cloneNode(true);
    that.removeUnwantedElementsFromContentElement(content);
    that.processImages(content);
    util.removeEmptyDivElements(content);
    let epubItems = that.splitContentIntoSections(content, that.firstPageDom.baseURI);
    that.fixupFootnotes(epubItems);
    return new EpubItemSupplier(that, epubItems, that.imageCollector);
}

BakaTsukiParser.prototype.removeUnwantedElementsFromContentElement = function (element) {
    let that = this;
    util.removeElements(that.getElements(element, "script"));
    // Strip headline id of illegal characters that epubcheck doesn't like
    let headlines = util.getElements(element, "span", e => (e.className === "mw-headline"));
    for(let hl of headlines) {
        hl.setAttribute("id", util.safeForId(hl.getAttribute("id")));
    }

    // discard table of contents (will generate one from tags later)
    util.removeElements(that.getElements(element, "div", e => (e.id === "toc")));

    util.removeComments(element);
    that.removeUnwantedTable(element);

    // hyperlinks that allow editing text
    util.removeElements(that.getElements(element, "span", e => (e.className === "mw-editsection")));
};

// There's a table at end of content, with links to other stories on Baka Tsuki.
// It's not wanted in the EPUB
BakaTsukiParser.prototype.removeUnwantedTable = function (element) {
    // sometimes the target table has other tables nested in it.
    let that = this;
    let tables = that.getElements(element, "table");
    if (0 < tables.length) {
        let endTable = tables[tables.length - 1];
        let node = endTable;
        while (node.parentNode != null) {
            node = node.parentNode;
            if (node.tagName === "TABLE") {
                endTable = node;
            }
        }
        util.removeNode(endTable);
    }
}

BakaTsukiParser.prototype.processImages = function (element) {
    let that = this;
    that.stripGalleryBox(element);
    that.imageCollector.processImages(element);
}

// remove gallery text and move images out of the gallery box so images can take full screen.
BakaTsukiParser.prototype.stripGalleryBox = function (element) {
    let that = this;

    // move images out of the <ul> gallery
    let garbage = new Set();
    for(let listItem of util.getElements(element, "li", e => (e.className === "gallerybox"))) {
        for(let d of util.getElements(listItem, "div")) {
            that.stripWidthStyle(d);
        }
        util.removeElements(that.getElements(listItem, "div", e => (e.className === "gallerytext")));

        let gallery = listItem.parentNode;
        garbage.add(gallery);
        gallery.parentNode.insertBefore(listItem.firstChild, gallery);
    }

    // throw away rest of gallery  (note sometimes there are multiple galleries)
    for(let node of garbage) {
        util.removeNode(node);
    }
}

BakaTsukiParser.prototype.stripWidthStyle = function (element) {
    let that = this;
    let style = element.getAttribute("style");
    if (style !== null && style.startsWith("width: ")) {
        element.removeAttribute("style");
    }
}

BakaTsukiParser.prototype.splitContentIntoSections = function (content, sourceUrl) {
    let that = this;
    that.flattenContent(content);
    let epubItems = that.splitContentOnHeadingTags(content, sourceUrl);
    epubItems = that.consolidateEpubItems(epubItems);
    epubItems = that.discardEpubItemsWithNoVisibleContent(epubItems);
    that.indexEpubItems(epubItems);
    return epubItems;
}

BakaTsukiParser.prototype.flattenContent = function (content) {
    // most pages have all header tags as immediate children of the content element
    // where this is not the case, flatten them so that they are.
    let that = this;
    for(let i = 0; i < content.childNodes.length; ++i) {
        let node = content.childNodes[i];
        if (that.nodeNeedsToBeFlattened(node)) {
            for(let j = node.childNodes.length - 1; 0 <= j; --j) {
                that.insertAfter(node, node.childNodes[j]);
            }
            util.removeNode(node);
            --i;
        }
    }
}

BakaTsukiParser.prototype.nodeNeedsToBeFlattened = function (node) {
    let that = this;
    let numHeaders = that.numberOfHeaderTags(node);
    return ((1 < numHeaders) || ((numHeaders === 1) && !that.isChapterStart(node)));
}

BakaTsukiParser.prototype.numberOfHeaderTags = function (node) {
    let that = this;
    let walker = document.createTreeWalker(node); 
    let count = 0;
    do {
        if (that.isChapterStart(walker.currentNode)) {
            ++count;
        };
    } while (walker.nextNode());
    return count;
}

BakaTsukiParser.prototype.insertAfter = function (atNode, nodeToInsert) {
    let nextSibling = atNode.nextSibling;
    if (nextSibling != null) {
        atNode.parentNode.insertBefore(nodeToInsert, nextSibling);
    } else {
        atNode.parentNode.appendChild(nodeToInsert);
    }
}

BakaTsukiParser.prototype.splitContentOnHeadingTags = function (content, sourceUrl) {
    let that = this;
    let epubItems = [];
    let elementsInItem = [];
    for(let i = 0; i < content.childNodes.length; ++i) {
        let node = that.wrapRawTextNode(content.childNodes[i]);
        if (that.isChapterStart(node)) {
            that.appendToEpubItems(epubItems, elementsInItem, sourceUrl);
            elementsInItem = [];
        }
        elementsInItem.push(node);
    }
    that.appendToEpubItems(epubItems, elementsInItem, sourceUrl);
    return epubItems;
}

// wrap any raw text in <p></p> tags
BakaTsukiParser.prototype.wrapRawTextNode = function (node) {
    if ((node.nodeType === Node.TEXT_NODE) && !util.isStringWhiteSpace(node.nodeValue)) {
        let wrapper = node.ownerDocument.createElement("p");
        wrapper.appendChild(node.ownerDocument.createTextNode(node.nodeValue));
        return wrapper;
    } else {
        return node;
    }
}

BakaTsukiParser.prototype.isChapterStart = function (node) {
    return util.isHeaderTag(node);
}

BakaTsukiParser.prototype.appendToEpubItems = function(epubItems, elementsInItem, sourceUrl) {
    let that = this;
    that.removeTrailingWhiteSpace(elementsInItem);
    if (0 < elementsInItem.length) {
        let epubItem = new EpubItem(sourceUrl);
        epubItem.elements = elementsInItem;
        epubItems.push(epubItem);
    }
}

BakaTsukiParser.prototype.removeTrailingWhiteSpace = function (elementsInItem) {
    let i = elementsInItem.length - 1;
    while ((0 <= i) && util.isElementWhiteSpace(elementsInItem[i])) {
        elementsInItem.pop();
        --i;
    }
}

// If a epubItem only holds a heading element, combine with following epubItem.
// e.g. We're dealing with <h1> followed by <h2>
BakaTsukiParser.prototype.consolidateEpubItems = function (epubItems) {
    let newEpubItems = [ epubItems[epubItems.length - 1] ];
    let i = epubItems.length - 2;
    while (0 <= i) {
        let epubItem = epubItems[i];
        if (epubItem.elements.length === 1) {
            newEpubItems[0].elements.unshift(epubItem.elements[0]);
        } else {
            newEpubItems.unshift(epubItem);
        }
        --i;
    }
    return newEpubItems;
}

BakaTsukiParser.prototype.discardEpubItemsWithNoVisibleContent = function(epubItems) {
    let that = this;
    return epubItems.filter(item => that.hasVisibleContent(item.elements));
}

BakaTsukiParser.prototype.hasVisibleContent = function(elements) {
    for (let element of elements) {
        if (!util.isElementWhiteSpace(element)) {
            return true;
        }
    }

    // if get here, no visible content
    return false;
}

BakaTsukiParser.prototype.indexEpubItems = function(epubItems) {
    // ToDo: when have image files, this will probably need to be redone.
    let that = this;
    let index = 0;
    for(let epubItem of  epubItems) {
        epubItem.setIndex(index);
        ++index;
    }
}

BakaTsukiParser.prototype.fixupFootnotes = function(epubItems) {
    let footnotes = this.findFootnotes(epubItems);
    this.findAndFixCitations(epubItems, footnotes);
}

BakaTsukiParser.prototype.findFootnotes = function(epubItems) {
    let that = this;
    let footnotes = new Map();
    that.walkEpubItemsWithElements(
        epubItems, 
        footnotes,
        that.recordFootnote
    );
    return footnotes;
}

BakaTsukiParser.prototype.findAndFixCitations = function(epubItems, footnotes) {
    let that = this;
    that.walkEpubItemsWithElements(
        epubItems, 
        footnotes,
        that.fixCitation
    );
}

BakaTsukiParser.prototype.walkEpubItemsWithElements = function(epubItems, footnotes, processFoundNode) {
    let that = this;
    for(let epubItem of epubItems) {
        for(let element of epubItem.elements) {
            let walker = document.createTreeWalker(
                element, 
                NodeFilter.SHOW_ELEMENT
            );
            
            // assume first header tag we find is title of the chapter.
            if(util.isHeaderTag(element) && (epubItem.chapterTitle === null)){
                epubItem.chapterTitle = element.textContent;
            }
            do {
                processFoundNode.apply(that, [walker.currentNode, footnotes, util.makeRelative(epubItem.getZipHref())]);
            } while (walker.nextNode());
        };
    };
}

BakaTsukiParser.prototype.isFootNote = function(node) {
    return ((node.tagName === "LI") && (node.id.indexOf("cite_note") === 0));
}

BakaTsukiParser.prototype.isCitation = function(node) {
    return ((node.tagName === "SUP") && (node.className === "reference"));
}

BakaTsukiParser.prototype.recordFootnote = function(node, footnotes, href) {
    let that = this;
    if (that.isFootNote(node)) {
        footnotes.set(
            node.id, 
            { link: that.getElement(node, "a"), 
                href: href 
            }
        );
    };
}

BakaTsukiParser.prototype.fixCitation = function(citation, footnotes, citationHref) {
    let that = this;
    if (that.isCitation(citation)) {
        let citationLinkElement = that.getElement(citation, "a");
        let footnoteId = that.extractFootnoteIdFromCitation(citationLinkElement);
        let footnote = footnotes.get(footnoteId);
        if (footnote != null) {
            footnote.link.href = citationHref + '#' + citation.id; 
            citationLinkElement.href = footnote.href + '#' + footnoteId;
        }
    }
}

BakaTsukiParser.prototype.extractFootnoteIdFromCitation = function(citationLinkElement) {
    if (citationLinkElement == null) {
        return null;
    } else {
        let href = citationLinkElement.href;
        let index = href.indexOf("#");
        return (index < 0) ? null : href.slice((index + 1) - href.length);
    }
}

BakaTsukiParser.prototype.onFetchImagesClicked = function () {
    let that = this;
    if (0 == that.imageCollector.images.size) {
        alert("No images found.");
    } else {
        that.getFetchContentButton().disabled = true;
        that.fetchContent();
    }
}

BakaTsukiParser.prototype.fetchContent = function () {
    let that = this;
    this.setUiToShowLoadingProgress(that.imageCollector.numberOfImagesToFetch());
    return that.imageCollector.fetchImages(() => that.updateProgressBarOneStep())
        .then(function() {
            main.getPackEpubButton().disabled = false;
            that.getFetchContentButton().disabled = false;
        }).catch(function (err) {
            alert(err);
        });
}

BakaTsukiParser.prototype.updateProgressBarOneStep = function() {
    this.updateLoadState(false);
}

/*
   Show progress,
   finished  true if have loaded all images, false if only loaded a single image
*/
BakaTsukiParser.prototype.updateLoadState = function(finished) {
    let that = this;
    that.getProgressBar().value += 1;
}


BakaTsukiParser.prototype.getFetchContentButton = function() {
    return document.getElementById("fetchImagesButton");
}

BakaTsukiParser.prototype.onCoverFromUrlClick = function(enable) {
    this.imageCollector.onCoverFromUrlClick(enable);
}
