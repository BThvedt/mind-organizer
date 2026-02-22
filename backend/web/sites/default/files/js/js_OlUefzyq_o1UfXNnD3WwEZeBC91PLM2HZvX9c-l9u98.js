/* @license GPL-2.0-or-later https://www.drupal.org/licensing/faq */
(function(Drupal,htmx,drupalSettings,loadjs){Drupal.htmx={mergeSettings(current,...sources){if(!current)return {};sources.filter((obj)=>Boolean(obj)).forEach((obj)=>{Object.entries(obj).forEach(([key,value])=>{switch(Object.prototype.toString.call(value)){case '[object Object]':current[key]=current[key]||{};current[key]=Drupal.htmx.mergeSettings(current[key],value);break;case '[object Array]':current[key]=Drupal.htmx.mergeSettings(new Array(value.length),value);break;default:current[key]=value;}});});return current;},addAssets(data){const bundleIds=data.filter(({href,src})=>!loadjs.isDefined(href??src)).map(({href,src,type,...attributes})=>{const bundleId=href??src;let prefix='css!';if(src)prefix=type==='module'?'module!':'';loadjs(prefix+bundleId,bundleId,{async:!src,before(path,element){Object.entries(attributes).forEach(([name,value])=>{element.setAttribute(name,value);});}});return bundleId;});let assetsLoaded=Promise.resolve();if(bundleIds.length)assetsLoaded=new Promise((resolve,reject)=>{loadjs.ready(bundleIds,{success:resolve,error(depsNotFound){const message=Drupal.t(`The following files could not be loaded: @dependencies`,{'@dependencies':depsNotFound.join(', ')});reject(message);}});});return assetsLoaded;}};})(Drupal,htmx,drupalSettings,loadjs);;
(function(Drupal,drupalSettings,htmx){const requestAssetsLoaded=new WeakMap();htmx.on('htmx:beforeRequest',({detail})=>{requestAssetsLoaded.set(detail.xhr,Promise.resolve());});htmx.on('htmx:configRequest',({detail})=>{if(Drupal.url.isLocal(detail.path)){if(detail.elt.hasAttribute('data-hx-drupal-only-main-content')){const url=new URL(detail.path,window.location);url.searchParams.set('_wrapper_format','drupal_htmx');detail.path=url.toString();}const pageState=drupalSettings.ajaxPageState;detail.parameters['ajax_page_state[theme]']=pageState.theme;detail.parameters['ajax_page_state[theme_token]']=pageState.theme_token;detail.parameters['ajax_page_state[libraries]']=pageState.libraries;if(detail.headers['HX-Trigger-Name'])detail.parameters._triggering_element_name=detail.headers['HX-Trigger-Name'];}});htmx.on('htmx:beforeHistoryUpdate',({detail})=>{const url=new URL(detail.history.path,window.location);['_wrapper_format','ajax_page_state[theme]','ajax_page_state[theme_token]','ajax_page_state[libraries]','_triggering_element_name','_triggering_element_value'].forEach((key)=>{url.searchParams.delete(key);});detail.history.path=url.toString();});htmx.on('htmx:beforeSwap',({detail})=>{htmx.trigger(detail.elt,'htmx:drupal:unload');if(!detail.xhr)return;let responseHTML=Document.parseHTMLUnsafe(detail.serverResponse);const settingsElement=responseHTML.querySelector(':is(head, body) > script[type="application/json"][data-drupal-selector="drupal-settings-json"]');settingsElement?.remove();if(settingsElement!==null)Drupal.htmx.mergeSettings(drupalSettings,JSON.parse(settingsElement.textContent));const assetsElements=responseHTML.querySelectorAll('link[rel="stylesheet"][href], script[src]');assetsElements.forEach((element)=>element.remove());const data=Array.from(assetsElements).map(({attributes})=>{const attrs={};Object.values(attributes).forEach(({name,value})=>{attrs[name]=value;});return attrs;});detail.serverResponse=responseHTML.documentElement.outerHTML;responseHTML=null;requestAssetsLoaded.get(detail.xhr).then(()=>Drupal.htmx.addAssets(data));});htmx.on('htmx:afterSettle',({detail})=>{(requestAssetsLoaded.get(detail.xhr)||Promise.resolve()).then(()=>{htmx.trigger(detail.elt.parentNode,'htmx:drupal:load');requestAssetsLoaded.delete(detail.xhr);});});})(Drupal,drupalSettings,htmx);;
(function(Drupal,htmx,drupalSettings){let attachFromHtmx=false;htmx.on('htmx:drupal:load',({detail})=>{attachFromHtmx=true;Drupal.attachBehaviors(detail.elt,drupalSettings);attachFromHtmx=false;});htmx.on('htmx:drupal:unload',({detail})=>{Drupal.detachBehaviors(detail.elt,drupalSettings,'unload');});Drupal.behaviors.htmx={attach(context){if(!attachFromHtmx&&context!==document)htmx.process(context);}};})(Drupal,htmx,drupalSettings);;
((Drupal,drupalSettings,htmx)=>{Drupal.bigPipe={};Drupal.bigPipe.commandExecutionQueue=function(response,status){const ajaxCommands=Drupal.bigPipe.commands;return Object.keys(response||{}).reduce((executionQueue,key)=>executionQueue.then(()=>{const {command}=response[key];if(command&&ajaxCommands[command])return ajaxCommands[command](response[key],status);}),Promise.resolve());};Drupal.bigPipe.commands={insert({data,method,selector}){const targets=htmx.findAll(selector);if(!targets||!targets.length)return;const styleMap={replaceWith:'outerHTML',html:'innerHTML',before:'beforebegin',prepend:'afterbegin',append:'beforeend',after:'afterend'};targets.forEach((target)=>{htmx.trigger(target,'htmx:drupal:unload');htmx.swap(target,data,{swapStyle:styleMap[method]||'outerHTML'});});},redirect({url}){window.location=url;},settings({merge,settings}){if(merge)Drupal.htmx.mergeSettings(drupalSettings,settings);},add_css({data}){return Drupal.htmx.addAssets(data);},message({message,messageOptions,messageWrapperQuerySelector,clearPrevious}){const messages=new Drupal.Message(document.querySelector(messageWrapperQuerySelector));if(clearPrevious)messages.clear();messages.add(message,messageOptions);},add_js({data}){return Drupal.htmx.addAssets(data).then(()=>{htmx.trigger(document.body,'htmx:drupal:load');});}};})(Drupal,drupalSettings,htmx);;
((Drupal,drupalSettings)=>{const replacementsSelector=`script[data-big-pipe-replacement-for-placeholder-with-id]`;function mapTextContentToAjaxResponse(content){if(content==='')return false;try{return JSON.parse(content);}catch(e){return false;}}function processReplacement(replacement){const id=replacement.dataset.bigPipeReplacementForPlaceholderWithId;const content=replacement.textContent.trim();if(typeof drupalSettings.bigPipePlaceholderIds[id]==='undefined')return;const response=mapTextContentToAjaxResponse(content);if(response===false)return;delete drupalSettings.bigPipePlaceholderIds[id];Drupal.bigPipe.commandExecutionQueue(response,'success');}function checkMutation(node){return Boolean(node.nodeType===Node.ELEMENT_NODE&&node.nodeName==='SCRIPT'&&node.dataset?.bigPipeReplacementForPlaceholderWithId&&typeof drupalSettings.bigPipePlaceholderIds[node.dataset.bigPipeReplacementForPlaceholderWithId]!=='undefined');}function checkMutationAndProcess(node){if(checkMutation(node))processReplacement(node);else{if(node.parentNode!==null&&checkMutation(node.parentNode))processReplacement(node.parentNode);}}function processMutations(mutations){mutations.forEach(({addedNodes,type,target})=>{addedNodes.forEach(checkMutationAndProcess);if(type==='characterData'&&checkMutation(target.parentNode)&&drupalSettings.bigPipePlaceholderIds[target.parentNode.dataset.bigPipeReplacementForPlaceholderWithId]===true)processReplacement(target.parentNode);});}const observer=new MutationObserver(processMutations);Drupal.attachBehaviors(document);document.querySelectorAll(replacementsSelector).forEach(processReplacement);observer.observe(document.body,{childList:true,subtree:true,characterData:true});window.addEventListener('DOMContentLoaded',()=>{const mutations=observer.takeRecords();observer.disconnect();if(mutations.length)processMutations(mutations);});})(Drupal,drupalSettings);;
(function($,Drupal,{tabbable,isTabbable}){function TabbingManager(){this.stack=[];}function TabbingContext(options){$.extend(this,{level:null,$tabbableElements:$(),$disabledElements:$(),released:false,active:false,trapFocus:false},options);}$.extend(TabbingManager.prototype,{constrain(elements,{trapFocus=false}={}){const il=this.stack.length;for(let i=0;i<il;i++)this.stack[i].deactivate();let tabbableElements=[];$(elements).each((index,rootElement)=>{tabbableElements=[...tabbableElements,...tabbable(rootElement)];if(isTabbable(rootElement))tabbableElements=[...tabbableElements,rootElement];});const tabbingContext=new TabbingContext({level:this.stack.length,$tabbableElements:$(tabbableElements),trapFocus});this.stack.push(tabbingContext);tabbingContext.activate();$(document).trigger('drupalTabbingConstrained',tabbingContext);return tabbingContext;},release(){let toActivate=this.stack.length-1;while(toActivate>=0&&this.stack[toActivate].released)toActivate--;this.stack.splice(toActivate+1);if(toActivate>=0)this.stack[toActivate].activate();},activate(tabbingContext){const $set=tabbingContext.$tabbableElements;const level=tabbingContext.level;const $disabledSet=$(tabbable(document.body)).not($set);tabbingContext.$disabledElements=$disabledSet;const il=$disabledSet.length;for(let i=0;i<il;i++)this.recordTabindex($disabledSet.eq(i),level);$disabledSet.prop('tabindex',-1).prop('autofocus',false);let $hasFocus=$set.filter('[autofocus]').eq(-1);if($hasFocus.length===0)$hasFocus=$set.eq(0);$hasFocus.trigger('focus');if($set.length&&tabbingContext.trapFocus){$set.last().on('keydown.focus-trap',(event)=>{if(event.key==='Tab'&&!event.shiftKey){event.preventDefault();$set.first().focus();}});$set.first().on('keydown.focus-trap',(event)=>{if(event.key==='Tab'&&event.shiftKey){event.preventDefault();$set.last().focus();}});}},deactivate(tabbingContext){const $set=tabbingContext.$disabledElements;const level=tabbingContext.level;const il=$set.length;tabbingContext.$tabbableElements.first().off('keydown.focus-trap');tabbingContext.$tabbableElements.last().off('keydown.focus-trap');for(let i=0;i<il;i++)this.restoreTabindex($set.eq(i),level);},recordTabindex($el,level){const tabInfo=$el.data('drupalOriginalTabIndices')||{};tabInfo[level]={tabindex:$el[0].getAttribute('tabindex'),autofocus:$el[0].hasAttribute('autofocus')};$el.data('drupalOriginalTabIndices',tabInfo);},restoreTabindex($el,level){const tabInfo=$el.data('drupalOriginalTabIndices');if(tabInfo&&tabInfo[level]){const data=tabInfo[level];if(data.tabindex)$el[0].setAttribute('tabindex',data.tabindex);else $el[0].removeAttribute('tabindex');if(data.autofocus)$el[0].setAttribute('autofocus','autofocus');if(level===0)$el.removeData('drupalOriginalTabIndices');else{let levelToDelete=level;while(tabInfo.hasOwnProperty(levelToDelete)){delete tabInfo[levelToDelete];levelToDelete++;}$el.data('drupalOriginalTabIndices',tabInfo);}}}});$.extend(TabbingContext.prototype,{release(){if(!this.released){this.deactivate();this.released=true;Drupal.tabbingManager.release(this);$(document).trigger('drupalTabbingContextReleased',this);}},activate(){if(!this.active&&!this.released){this.active=true;Drupal.tabbingManager.activate(this);$(document).trigger('drupalTabbingContextActivated',this);}},deactivate(){if(this.active){this.active=false;Drupal.tabbingManager.deactivate(this);$(document).trigger('drupalTabbingContextDeactivated',this);}}});if(Drupal.tabbingManager)return;Drupal.tabbingManager=new TabbingManager();})(jQuery,Drupal,window.tabbable);;
(($,Drupal)=>{Drupal.contextual.ContextualToolbarModelView=class{constructor(options){this.strings=options.strings;this.isVisible=false;this._contextualCount=Drupal.contextual.instances.count;this.tabbingContext=null;this._isViewing=localStorage.getItem('Drupal.contextualToolbar.isViewing')!=='false';this.$el=options.el;window.addEventListener('contextual-instances-added',()=>this.lockNewContextualLinks());window.addEventListener('contextual-instances-removed',()=>{this.contextualCount=Drupal.contextual.instances.count;});this.$el.on({click:()=>{this.isViewing=!this.isViewing;},touchend:(event)=>{event.preventDefault();event.target.click();},'click touchend':()=>this.render()});$(document).on('keyup',(event)=>this.onKeypress(event));this.manageTabbing(true);this.render();}onKeypress(event){if(!this.announcedOnce&&event.keyCode===9&&!this.isViewing){this.announceTabbingConstraint();this.announcedOnce=true;}if(event.keyCode===27)this.isViewing=true;}render(){this.$el[0].classList.toggle('hidden',this.isVisible);const button=this.$el[0].querySelector('button');button.classList.toggle('is-active',!this.isViewing);button.setAttribute('aria-pressed',!this.isViewing);this.contextualCount=Drupal.contextual.instances.count;}updateVisibility(){this.isVisible=this.get('contextualCount')>0;}lockNewContextualLinks(){Drupal.contextual.instances.forEach((model)=>{model.isLocked=!this.isViewing;});this.contextualCount=Drupal.contextual.instances.count;}manageTabbing(init=false){let {tabbingContext}=this;if(tabbingContext&&!init){if(tabbingContext.active)Drupal.announce(this.strings.tabbingReleased);tabbingContext.release();this.tabbingContext=null;}if(!this.isViewing){tabbingContext=Drupal.tabbingManager.constrain($('.contextual-toolbar-tab, .contextual'));this.tabbingContext=tabbingContext;this.announceTabbingConstraint();this.announcedOnce=true;}}announceTabbingConstraint(){const {strings}=this;Drupal.announce(Drupal.formatString(strings.tabbingConstrained,{'@contextualsCount':Drupal.formatPlural(Drupal.contextual.instances.length,'@count contextual link','@count contextual links')})+strings.pressEsc);}get isViewing(){return this._isViewing;}set isViewing(value){this._isViewing=value;localStorage[!value?'setItem':'removeItem']('Drupal.contextualToolbar.isViewing','false');Drupal.contextual.instances.forEach((model)=>{model.isLocked=!this.isViewing;});this.manageTabbing();}get contextualCount(){return this._contextualCount;}set contextualCount(value){if(value!==this._contextualCount){this._contextualCount=value;this.updateVisibility();}}};})(jQuery,Drupal);;
(function($,Drupal){const strings={tabbingReleased:Drupal.t('Tabbing is no longer constrained by the Contextual module.'),tabbingConstrained:Drupal.t('Tabbing is constrained to a set of @contextualsCount and the edit mode toggle.'),pressEsc:Drupal.t('Press the esc key to exit.')};function initContextualToolbar(context){if(!Drupal.contextual||!Drupal.contextual.instances)return;const {contextualToolbar}=Drupal;const viewOptions={el:$('.toolbar .toolbar-bar .contextual-toolbar-tab'),strings};contextualToolbar.model=new Drupal.contextual.ContextualToolbarModelView(viewOptions);}Drupal.behaviors.contextualToolbar={attach(context){if(once('contextualToolbar-init','body').length)initContextualToolbar(context);}};Drupal.contextualToolbar={model:null};})(jQuery,Drupal);;
(function(Drupal,drupalSettings){Drupal.behaviors.activeLinks={attach(context){const path=drupalSettings.path;const queryString=JSON.stringify(path.currentQuery);const querySelector=queryString?`[data-drupal-link-query="${CSS.escape(queryString)}"]`:':not([data-drupal-link-query])';const originalSelectors=[`[data-drupal-link-system-path="${CSS.escape(path.currentPath)}"]`];let selectors;if(path.isFront)originalSelectors.push('[data-drupal-link-system-path="<front>"]');selectors=[].concat(originalSelectors.map((selector)=>`${selector}:not([data-drupal-language]):not([hreflang])`),originalSelectors.map((selector)=>`li${selector}[data-drupal-language="${path.currentLanguage}"]`),originalSelectors.map((selector)=>`a${selector}[hreflang="${path.currentLanguage}"]`));selectors=selectors.map((current)=>current+querySelector);context.querySelectorAll(selectors.join(',')).forEach((activeLink)=>{activeLink.classList.add('is-active');activeLink.setAttribute('aria-current','page');});},detach(context,settings,trigger){if(trigger==='unload')context.querySelectorAll('[data-drupal-link-system-path].is-active').forEach((activeLink)=>{activeLink.classList.remove('is-active');activeLink.removeAttribute('aria-current');});}};})(Drupal,drupalSettings);;
(function($,Drupal,drupalSettings){const pathInfo=drupalSettings.path;const escapeAdminPath=sessionStorage.getItem('escapeAdminPath');const windowLocation=window.location;if(!pathInfo.currentPathIsAdmin&&!windowLocation.search.includes('destination='))sessionStorage.setItem('escapeAdminPath',windowLocation);Drupal.behaviors.escapeAdmin={attach(){const toolbarEscape=once('escapeAdmin','[data-toolbar-escape-admin]');if(toolbarEscape.length&&pathInfo.currentPathIsAdmin&&escapeAdminPath!==null)$(toolbarEscape).attr('href',escapeAdminPath);}};})(jQuery,Drupal,drupalSettings);;
(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.autoComplete = factory());
})(this, (function () { 'use strict';

  function ownKeys(object, enumerableOnly) {
    var keys = Object.keys(object);

    if (Object.getOwnPropertySymbols) {
      var symbols = Object.getOwnPropertySymbols(object);
      enumerableOnly && (symbols = symbols.filter(function (sym) {
        return Object.getOwnPropertyDescriptor(object, sym).enumerable;
      })), keys.push.apply(keys, symbols);
    }

    return keys;
  }

  function _objectSpread2(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = null != arguments[i] ? arguments[i] : {};
      i % 2 ? ownKeys(Object(source), !0).forEach(function (key) {
        _defineProperty(target, key, source[key]);
      }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys(Object(source)).forEach(function (key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }

    return target;
  }

  function _typeof(obj) {
    "@babel/helpers - typeof";

    return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj) {
      return typeof obj;
    } : function (obj) {
      return obj && "function" == typeof Symbol && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj;
    }, _typeof(obj);
  }

  function _defineProperty(obj, key, value) {
    if (key in obj) {
      Object.defineProperty(obj, key, {
        value: value,
        enumerable: true,
        configurable: true,
        writable: true
      });
    } else {
      obj[key] = value;
    }

    return obj;
  }

  function _toConsumableArray(arr) {
    return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread();
  }

  function _arrayWithoutHoles(arr) {
    if (Array.isArray(arr)) return _arrayLikeToArray(arr);
  }

  function _iterableToArray(iter) {
    if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter);
  }

  function _unsupportedIterableToArray(o, minLen) {
    if (!o) return;
    if (typeof o === "string") return _arrayLikeToArray(o, minLen);
    var n = Object.prototype.toString.call(o).slice(8, -1);
    if (n === "Object" && o.constructor) n = o.constructor.name;
    if (n === "Map" || n === "Set") return Array.from(o);
    if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
  }

  function _arrayLikeToArray(arr, len) {
    if (len == null || len > arr.length) len = arr.length;

    for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i];

    return arr2;
  }

  function _nonIterableSpread() {
    throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
  }

  function _createForOfIteratorHelper(o, allowArrayLike) {
    var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"];

    if (!it) {
      if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") {
        if (it) o = it;
        var i = 0;

        var F = function () {};

        return {
          s: F,
          n: function () {
            if (i >= o.length) return {
              done: true
            };
            return {
              done: false,
              value: o[i++]
            };
          },
          e: function (e) {
            throw e;
          },
          f: F
        };
      }

      throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
    }

    var normalCompletion = true,
        didErr = false,
        err;
    return {
      s: function () {
        it = it.call(o);
      },
      n: function () {
        var step = it.next();
        normalCompletion = step.done;
        return step;
      },
      e: function (e) {
        didErr = true;
        err = e;
      },
      f: function () {
        try {
          if (!normalCompletion && it.return != null) it.return();
        } finally {
          if (didErr) throw err;
        }
      }
    };
  }

  var select$1 = function select(element) {
    return typeof element === "string" ? document.querySelector(element) : element();
  };
  var create = function create(tag, options) {
    var el = typeof tag === "string" ? document.createElement(tag) : tag;
    for (var key in options) {
      var val = options[key];
      if (key === "inside") {
        val.append(el);
      } else if (key === "dest") {
        select$1(val[0]).insertAdjacentElement(val[1], el);
      } else if (key === "around") {
        var ref = val;
        ref.parentNode.insertBefore(el, ref);
        el.append(ref);
        if (ref.getAttribute("autofocus") != null) ref.focus();
      } else if (key in el) {
        el[key] = val;
      } else {
        el.setAttribute(key, val);
      }
    }
    return el;
  };
  var getQuery = function getQuery(field) {
    return field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value : field.innerHTML;
  };
  var format = function format(value, diacritics) {
    value = String(value).toLowerCase();
    return diacritics ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC") : value;
  };
  var debounce = function debounce(callback, duration) {
    var timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        return callback();
      }, duration);
    };
  };
  var checkTrigger = function checkTrigger(query, condition, threshold) {
    return condition ? condition(query) : query.length >= threshold;
  };
  var mark = function mark(value, cls) {
    return create("mark", _objectSpread2({
      innerHTML: value
    }, typeof cls === "string" && {
      "class": cls
    })).outerHTML;
  };

  var configure = (function (ctx) {
    var name = ctx.name,
        options = ctx.options,
        resultsList = ctx.resultsList,
        resultItem = ctx.resultItem;
    for (var option in options) {
      if (_typeof(options[option]) === "object") {
        if (!ctx[option]) ctx[option] = {};
        for (var subOption in options[option]) {
          ctx[option][subOption] = options[option][subOption];
        }
      } else {
        ctx[option] = options[option];
      }
    }
    ctx.selector = ctx.selector || "#" + name;
    resultsList.destination = resultsList.destination || ctx.selector;
    resultsList.id = resultsList.id || name + "_list_" + ctx.id;
    resultItem.id = resultItem.id || name + "_result";
    ctx.input = select$1(ctx.selector);
  });

  var eventEmitter = (function (name, ctx) {
    ctx.input.dispatchEvent(new CustomEvent(name, {
      bubbles: true,
      detail: ctx.feedback,
      cancelable: true
    }));
  });

  var search = (function (query, record, options) {
    var _ref = options || {},
        mode = _ref.mode,
        diacritics = _ref.diacritics,
        highlight = _ref.highlight;
    var nRecord = format(record, diacritics);
    record = String(record);
    query = format(query, diacritics);
    if (mode === "loose") {
      query = query.replace(/ /g, "");
      var qLength = query.length;
      var cursor = 0;
      var match = Array.from(record).map(function (character, index) {
        if (cursor < qLength && nRecord[index] === query[cursor]) {
          character = highlight ? mark(character, highlight) : character;
          cursor++;
        }
        return character;
      }).join("");
      if (cursor === qLength) return match;
    } else {
      var _match = nRecord.indexOf(query);
      if (~_match) {
        query = record.substring(_match, _match + query.length);
        _match = highlight ? record.replace(query, mark(query, highlight)) : record;
        return _match;
      }
    }
  });

  var getData = function getData(ctx, query) {
    return new Promise(function ($return, $error) {
      var data;
      data = ctx.data;
      if (data.cache && data.store) return $return();
      return new Promise(function ($return, $error) {
        if (typeof data.src === "function") {
          return data.src(query).then($return, $error);
        }
        return $return(data.src);
      }).then(function ($await_4) {
        try {
          ctx.feedback = data.store = $await_4;
          eventEmitter("response", ctx);
          return $return();
        } catch ($boundEx) {
          return $error($boundEx);
        }
      }, $error);
    });
  };
  var findMatches = function findMatches(query, ctx) {
    var data = ctx.data,
        searchEngine = ctx.searchEngine;
    var matches = [];
    data.store.forEach(function (value, index) {
      var find = function find(key) {
        var record = key ? value[key] : value;
        var match = typeof searchEngine === "function" ? searchEngine(query, record) : search(query, record, {
          mode: searchEngine,
          diacritics: ctx.diacritics,
          highlight: ctx.resultItem.highlight
        });
        if (!match) return;
        var result = {
          match: match,
          value: value
        };
        if (key) result.key = key;
        matches.push(result);
      };
      if (data.keys) {
        var _iterator = _createForOfIteratorHelper(data.keys),
            _step;
        try {
          for (_iterator.s(); !(_step = _iterator.n()).done;) {
            var key = _step.value;
            find(key);
          }
        } catch (err) {
          _iterator.e(err);
        } finally {
          _iterator.f();
        }
      } else {
        find();
      }
    });
    if (data.filter) matches = data.filter(matches);
    var results = matches.slice(0, ctx.resultsList.maxResults);
    ctx.feedback = {
      query: query,
      matches: matches,
      results: results
    };
    eventEmitter("results", ctx);
  };

  var Expand = "aria-expanded";
  var Active = "aria-activedescendant";
  var Selected = "aria-selected";
  var feedback = function feedback(ctx, index) {
    ctx.feedback.selection = _objectSpread2({
      index: index
    }, ctx.feedback.results[index]);
  };
  var render = function render(ctx) {
    var resultsList = ctx.resultsList,
        list = ctx.list,
        resultItem = ctx.resultItem,
        feedback = ctx.feedback;
    var matches = feedback.matches,
        results = feedback.results;
    ctx.cursor = -1;
    list.innerHTML = "";
    if (matches.length || resultsList.noResults) {
      var fragment = new DocumentFragment();
      results.forEach(function (result, index) {
        var element = create(resultItem.tag, _objectSpread2({
          id: "".concat(resultItem.id, "_").concat(index),
          role: "option",
          innerHTML: result.match,
          inside: fragment
        }, resultItem["class"] && {
          "class": resultItem["class"]
        }));
        if (resultItem.element) resultItem.element(element, result);
      });
      list.append(fragment);
      if (resultsList.element) resultsList.element(list, feedback);
      open(ctx);
    } else {
      close(ctx);
    }
  };
  var open = function open(ctx) {
    if (ctx.isOpen) return;
    (ctx.wrapper || ctx.input).setAttribute(Expand, true);
    ctx.list.removeAttribute("hidden");
    ctx.isOpen = true;
    eventEmitter("open", ctx);
  };
  var close = function close(ctx) {
    if (!ctx.isOpen) return;
    (ctx.wrapper || ctx.input).setAttribute(Expand, false);
    ctx.input.setAttribute(Active, "");
    ctx.list.setAttribute("hidden", "");
    ctx.isOpen = false;
    eventEmitter("close", ctx);
  };
  var goTo = function goTo(index, ctx) {
    var resultItem = ctx.resultItem;
    var results = ctx.list.getElementsByTagName(resultItem.tag);
    var cls = resultItem.selected ? resultItem.selected.split(" ") : false;
    if (ctx.isOpen && results.length) {
      var _results$index$classL;
      var state = ctx.cursor;
      if (index >= results.length) index = 0;
      if (index < 0) index = results.length - 1;
      ctx.cursor = index;
      if (state > -1) {
        var _results$state$classL;
        results[state].removeAttribute(Selected);
        if (cls) (_results$state$classL = results[state].classList).remove.apply(_results$state$classL, _toConsumableArray(cls));
      }
      results[index].setAttribute(Selected, true);
      if (cls) (_results$index$classL = results[index].classList).add.apply(_results$index$classL, _toConsumableArray(cls));
      ctx.input.setAttribute(Active, results[ctx.cursor].id);
      ctx.list.scrollTop = results[index].offsetTop - ctx.list.clientHeight + results[index].clientHeight + 5;
      ctx.feedback.cursor = ctx.cursor;
      feedback(ctx, index);
      eventEmitter("navigate", ctx);
    }
  };
  var next = function next(ctx) {
    goTo(ctx.cursor + 1, ctx);
  };
  var previous = function previous(ctx) {
    goTo(ctx.cursor - 1, ctx);
  };
  var select = function select(ctx, event, index) {
    index = index >= 0 ? index : ctx.cursor;
    if (index < 0) return;
    ctx.feedback.event = event;
    feedback(ctx, index);
    eventEmitter("selection", ctx);
    close(ctx);
  };
  var click = function click(event, ctx) {
    var itemTag = ctx.resultItem.tag.toUpperCase();
    var items = Array.from(ctx.list.querySelectorAll(itemTag));
    var item = event.target.closest(itemTag);
    if (item && item.nodeName === itemTag) {
      select(ctx, event, items.indexOf(item));
    }
  };
  var navigate = function navigate(event, ctx) {
    switch (event.keyCode) {
      case 40:
      case 38:
        event.preventDefault();
        event.keyCode === 40 ? next(ctx) : previous(ctx);
        break;
      case 13:
        if (!ctx.submit) event.preventDefault();
        if (ctx.cursor >= 0) select(ctx, event);
        break;
      case 9:
        if (ctx.resultsList.tabSelect && ctx.cursor >= 0) select(ctx, event);
        break;
      case 27:
        ctx.input.value = "";
        close(ctx);
        break;
    }
  };

  function start (ctx, q) {
    var _this = this;
    return new Promise(function ($return, $error) {
      var queryVal, condition;
      queryVal = q || getQuery(ctx.input);
      queryVal = ctx.query ? ctx.query(queryVal) : queryVal;
      condition = checkTrigger(queryVal, ctx.trigger, ctx.threshold);
      if (condition) {
        return getData(ctx, queryVal).then(function ($await_2) {
          try {
            if (ctx.feedback instanceof Error) return $return();
            findMatches(queryVal, ctx);
            if (ctx.resultsList) render(ctx);
            return $If_1.call(_this);
          } catch ($boundEx) {
            return $error($boundEx);
          }
        }, $error);
      } else {
        close(ctx);
        return $If_1.call(_this);
      }
      function $If_1() {
        return $return();
      }
    });
  }

  var eventsManager = function eventsManager(events, callback) {
    for (var element in events) {
      for (var event in events[element]) {
        callback(element, event);
      }
    }
  };
  var addEvents = function addEvents(ctx) {
    var events = ctx.events;
    var run = debounce(function () {
      return start(ctx);
    }, ctx.debounce);
    var publicEvents = ctx.events = _objectSpread2({
      input: _objectSpread2({}, events && events.input)
    }, ctx.resultsList && {
      list: events ? _objectSpread2({}, events.list) : {}
    });
    var privateEvents = {
      input: {
        input: function input() {
          run();
        },
        keydown: function keydown(event) {
          navigate(event, ctx);
        },
        blur: function blur() {
          close(ctx);
        }
      },
      list: {
        mousedown: function mousedown(event) {
          event.preventDefault();
        },
        click: function click$1(event) {
          click(event, ctx);
        }
      }
    };
    eventsManager(privateEvents, function (element, event) {
      if (!ctx.resultsList && event !== "input") return;
      if (publicEvents[element][event]) return;
      publicEvents[element][event] = privateEvents[element][event];
    });
    eventsManager(publicEvents, function (element, event) {
      ctx[element].addEventListener(event, publicEvents[element][event]);
    });
  };
  var removeEvents = function removeEvents(ctx) {
    eventsManager(ctx.events, function (element, event) {
      ctx[element].removeEventListener(event, ctx.events[element][event]);
    });
  };

  function init (ctx) {
    var _this = this;
    return new Promise(function ($return, $error) {
      var placeHolder, resultsList, parentAttrs;
      placeHolder = ctx.placeHolder;
      resultsList = ctx.resultsList;
      parentAttrs = {
        role: "combobox",
        "aria-owns": resultsList.id,
        "aria-haspopup": true,
        "aria-expanded": false
      };
      create(ctx.input, _objectSpread2(_objectSpread2({
        "aria-controls": resultsList.id,
        "aria-autocomplete": "both"
      }, placeHolder && {
        placeholder: placeHolder
      }), !ctx.wrapper && _objectSpread2({}, parentAttrs)));
      if (ctx.wrapper) ctx.wrapper = create("div", _objectSpread2({
        around: ctx.input,
        "class": ctx.name + "_wrapper"
      }, parentAttrs));
      if (resultsList) ctx.list = create(resultsList.tag, _objectSpread2({
        dest: [resultsList.destination, resultsList.position],
        id: resultsList.id,
        role: "listbox",
        hidden: "hidden"
      }, resultsList["class"] && {
        "class": resultsList["class"]
      }));
      addEvents(ctx);
      if (ctx.data.cache) {
        return getData(ctx).then(function ($await_2) {
          try {
            return $If_1.call(_this);
          } catch ($boundEx) {
            return $error($boundEx);
          }
        }, $error);
      }
      function $If_1() {
        eventEmitter("init", ctx);
        return $return();
      }
      return $If_1.call(_this);
    });
  }

  function extend (autoComplete) {
    var prototype = autoComplete.prototype;
    prototype.init = function () {
      init(this);
    };
    prototype.start = function (query) {
      start(this, query);
    };
    prototype.unInit = function () {
      if (this.wrapper) {
        var parentNode = this.wrapper.parentNode;
        parentNode.insertBefore(this.input, this.wrapper);
        parentNode.removeChild(this.wrapper);
      }
      removeEvents(this);
    };
    prototype.open = function () {
      open(this);
    };
    prototype.close = function () {
      close(this);
    };
    prototype.goTo = function (index) {
      goTo(index, this);
    };
    prototype.next = function () {
      next(this);
    };
    prototype.previous = function () {
      previous(this);
    };
    prototype.select = function (index) {
      select(this, null, index);
    };
    prototype.search = function (query, record, options) {
      return search(query, record, options);
    };
  }

  function autoComplete(config) {
    this.options = config;
    this.id = autoComplete.instances = (autoComplete.instances || 0) + 1;
    this.name = "autoComplete";
    this.wrapper = 1;
    this.threshold = 1;
    this.debounce = 0;
    this.resultsList = {
      position: "afterend",
      tag: "ul",
      maxResults: 5
    };
    this.resultItem = {
      tag: "li"
    };
    configure(this);
    extend.call(this, autoComplete);
    init(this);
  }

  return autoComplete;

}));
;
"use strict";function _typeof(t){return(_typeof="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t})(t)}function _regeneratorRuntime(){_regeneratorRuntime=function(){return a};var a={},t=Object.prototype,u=t.hasOwnProperty,s=Object.defineProperty||function(t,e,n){t[e]=n.value},e="function"==typeof Symbol?Symbol:{},r=e.iterator||"@@iterator",n=e.asyncIterator||"@@asyncIterator",o=e.toStringTag||"@@toStringTag";function i(t,e,n){return Object.defineProperty(t,e,{value:n,enumerable:!0,configurable:!0,writable:!0}),t[e]}try{i({},"")}catch(t){i=function(t,e,n){return t[e]=n}}function c(t,e,n,r){var o,i,a,c,e=e&&e.prototype instanceof h?e:h,e=Object.create(e.prototype),r=new _(r||[]);return s(e,"_invoke",{value:(o=t,i=n,a=r,c="suspendedStart",function(t,e){if("executing"===c)throw new Error("Generator is already running");if("completed"===c){if("throw"===t)throw e;return L()}for(a.method=t,a.arg=e;;){var n=a.delegate;if(n){n=function t(e,n){var r=n.method,o=e.iterator[r];if(void 0===o)return n.delegate=null,"throw"===r&&e.iterator.return&&(n.method="return",n.arg=void 0,t(e,n),"throw"===n.method)||"return"!==r&&(n.method="throw",n.arg=new TypeError("The iterator does not provide a '"+r+"' method")),f;r=l(o,e.iterator,n.arg);if("throw"===r.type)return n.method="throw",n.arg=r.arg,n.delegate=null,f;o=r.arg;return o?o.done?(n[e.resultName]=o.value,n.next=e.nextLoc,"return"!==n.method&&(n.method="next",n.arg=void 0),n.delegate=null,f):o:(n.method="throw",n.arg=new TypeError("iterator result is not an object"),n.delegate=null,f)}(n,a);if(n){if(n===f)continue;return n}}if("next"===a.method)a.sent=a._sent=a.arg;else if("throw"===a.method){if("suspendedStart"===c)throw c="completed",a.arg;a.dispatchException(a.arg)}else"return"===a.method&&a.abrupt("return",a.arg);c="executing";n=l(o,i,a);if("normal"===n.type){if(c=a.done?"completed":"suspendedYield",n.arg===f)continue;return{value:n.arg,done:a.done}}"throw"===n.type&&(c="completed",a.method="throw",a.arg=n.arg)}})}),e}function l(t,e,n){try{return{type:"normal",arg:t.call(e,n)}}catch(t){return{type:"throw",arg:t}}}a.wrap=c;var f={};function h(){}function p(){}function d(){}var e={},y=(i(e,r,function(){return this}),Object.getPrototypeOf),y=y&&y(y(E([]))),v=(y&&y!==t&&u.call(y,r)&&(e=y),d.prototype=h.prototype=Object.create(e));function m(t){["next","throw","return"].forEach(function(e){i(t,e,function(t){return this._invoke(e,t)})})}function g(a,c){var e;s(this,"_invoke",{value:function(n,r){function t(){return new c(function(t,e){!function e(t,n,r,o){var i,t=l(a[t],a,n);if("throw"!==t.type)return(n=(i=t.arg).value)&&"object"==_typeof(n)&&u.call(n,"__await")?c.resolve(n.__await).then(function(t){e("next",t,r,o)},function(t){e("throw",t,r,o)}):c.resolve(n).then(function(t){i.value=t,r(i)},function(t){return e("throw",t,r,o)});o(t.arg)}(n,r,t,e)})}return e=e?e.then(t,t):t()}})}function w(t){var e={tryLoc:t[0]};1 in t&&(e.catchLoc=t[1]),2 in t&&(e.finallyLoc=t[2],e.afterLoc=t[3]),this.tryEntries.push(e)}function b(t){var e=t.completion||{};e.type="normal",delete e.arg,t.completion=e}function _(t){this.tryEntries=[{tryLoc:"root"}],t.forEach(w,this),this.reset(!0)}function E(e){if(e){var n,t=e[r];if(t)return t.call(e);if("function"==typeof e.next)return e;if(!isNaN(e.length))return n=-1,(t=function t(){for(;++n<e.length;)if(u.call(e,n))return t.value=e[n],t.done=!1,t;return t.value=void 0,t.done=!0,t}).next=t}return{next:L}}function L(){return{value:void 0,done:!0}}return s(v,"constructor",{value:p.prototype=d,configurable:!0}),s(d,"constructor",{value:p,configurable:!0}),p.displayName=i(d,o,"GeneratorFunction"),a.isGeneratorFunction=function(t){t="function"==typeof t&&t.constructor;return!!t&&(t===p||"GeneratorFunction"===(t.displayName||t.name))},a.mark=function(t){return Object.setPrototypeOf?Object.setPrototypeOf(t,d):(t.__proto__=d,i(t,o,"GeneratorFunction")),t.prototype=Object.create(v),t},a.awrap=function(t){return{__await:t}},m(g.prototype),i(g.prototype,n,function(){return this}),a.AsyncIterator=g,a.async=function(t,e,n,r,o){void 0===o&&(o=Promise);var i=new g(c(t,e,n,r),o);return a.isGeneratorFunction(e)?i:i.next().then(function(t){return t.done?t.value:i.next()})},m(v),i(v,o,"Generator"),i(v,r,function(){return this}),i(v,"toString",function(){return"[object Generator]"}),a.keys=function(t){var e,n=Object(t),r=[];for(e in n)r.push(e);return r.reverse(),function t(){for(;r.length;){var e=r.pop();if(e in n)return t.value=e,t.done=!1,t}return t.done=!0,t}},a.values=E,_.prototype={constructor:_,reset:function(t){if(this.prev=0,this.next=0,this.sent=this._sent=void 0,this.done=!1,this.delegate=null,this.method="next",this.arg=void 0,this.tryEntries.forEach(b),!t)for(var e in this)"t"===e.charAt(0)&&u.call(this,e)&&!isNaN(+e.slice(1))&&(this[e]=void 0)},stop:function(){this.done=!0;var t=this.tryEntries[0].completion;if("throw"===t.type)throw t.arg;return this.rval},dispatchException:function(n){if(this.done)throw n;var r=this;function t(t,e){return i.type="throw",i.arg=n,r.next=t,e&&(r.method="next",r.arg=void 0),!!e}for(var e=this.tryEntries.length-1;0<=e;--e){var o=this.tryEntries[e],i=o.completion;if("root"===o.tryLoc)return t("end");if(o.tryLoc<=this.prev){var a=u.call(o,"catchLoc"),c=u.call(o,"finallyLoc");if(a&&c){if(this.prev<o.catchLoc)return t(o.catchLoc,!0);if(this.prev<o.finallyLoc)return t(o.finallyLoc)}else if(a){if(this.prev<o.catchLoc)return t(o.catchLoc,!0)}else{if(!c)throw new Error("try statement without catch or finally");if(this.prev<o.finallyLoc)return t(o.finallyLoc)}}}},abrupt:function(t,e){for(var n=this.tryEntries.length-1;0<=n;--n){var r=this.tryEntries[n];if(r.tryLoc<=this.prev&&u.call(r,"finallyLoc")&&this.prev<r.finallyLoc){var o=r;break}}var i=(o=o&&("break"===t||"continue"===t)&&o.tryLoc<=e&&e<=o.finallyLoc?null:o)?o.completion:{};return i.type=t,i.arg=e,o?(this.method="next",this.next=o.finallyLoc,f):this.complete(i)},complete:function(t,e){if("throw"===t.type)throw t.arg;return"break"===t.type||"continue"===t.type?this.next=t.arg:"return"===t.type?(this.rval=this.arg=t.arg,this.method="return",this.next="end"):"normal"===t.type&&e&&(this.next=e),f},finish:function(t){for(var e=this.tryEntries.length-1;0<=e;--e){var n=this.tryEntries[e];if(n.finallyLoc===t)return this.complete(n.completion,n.afterLoc),b(n),f}},catch:function(t){for(var e=this.tryEntries.length-1;0<=e;--e){var n,r,o=this.tryEntries[e];if(o.tryLoc===t)return"throw"===(n=o.completion).type&&(r=n.arg,b(o)),r}throw new Error("illegal catch attempt")},delegateYield:function(t,e,n){return this.delegate={iterator:E(t),resultName:e,nextLoc:n},"next"===this.method&&(this.arg=void 0),f}},a}function _classCallCheck(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function _defineProperties(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,_toPropertyKey(r.key),r)}}function _createClass(t,e,n){return e&&_defineProperties(t.prototype,e),n&&_defineProperties(t,n),Object.defineProperty(t,"prototype",{writable:!1}),t}function _toPropertyKey(t){t=_toPrimitive(t,"string");return"symbol"===_typeof(t)?t:String(t)}function _toPrimitive(t,e){if("object"!==_typeof(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0===n)return("string"===e?String:Number)(t);n=n.call(t,e||"default");if("object"!==_typeof(n))return n;throw new TypeError("@@toPrimitive must return a primitive value.")}var __awaiter=function(t,a,c,u){return new(c=c||Promise)(function(n,e){function r(t){try{i(u.next(t))}catch(t){e(t)}}function o(t){try{i(u.throw(t))}catch(t){e(t)}}function i(t){var e;t.done?n(t.value):((e=t.value)instanceof c?e:new c(function(t){t(e)})).then(r,o)}i((u=u.apply(t,a||[])).next())})};new(function(){function t(){var e=this;_classCallCheck(this,t),this.isOpen=!1,this.keysPressed={},this.onResults=function(t){setTimeout(function(){e.autoCompleteJS.goTo(0)})},this.onSelection=function(t){t=t.detail.selection.value;"string"==typeof t.url&&e.go(t.url)},this.getData=function(){return __awaiter(e,void 0,void 0,_regeneratorRuntime().mark(function t(){var e,n,r;return _regeneratorRuntime().wrap(function(t){for(;;)switch(t.prev=t.next){case 0:if(t.prev=0,e=this.$element.dataset.cacheId,n=localStorage?JSON.parse(localStorage.getItem("exoValet")):null,localStorage&&null!==n&&(r=localStorage.getItem("exoValetCacheId"),e!==r)&&(localStorage.setItem("exoValetCacheId",e),n=null),null===n)return t.next=7,this.fetchData().then(function(t){var e=JSON.stringify(t);return e!==JSON.stringify({})&&localStorage.setItem("exoValet",e),t});t.next=11;break;case 7:return r=t.sent,t.abrupt("return",r);case 11:return t.abrupt("return",n);case 12:t.next=17;break;case 14:return t.prev=14,t.t0=t.catch(0),t.abrupt("return",t.t0);case 17:case"end":return t.stop()}},t,this,[[0,14]])}))},this.fetchData=function(){return __awaiter(e,void 0,void 0,_regeneratorRuntime().mark(function t(){var e;return _regeneratorRuntime().wrap(function(t){for(;;)switch(t.prev=t.next){case 0:return t.prev=0,t.next=3,fetch(drupalSettings.path.baseUrl+"api/valet");case 3:return e=t.sent,t.next=6,e.json();case 6:return e=t.sent,t.abrupt("return",e);case 10:return t.prev=10,t.t0=t.catch(0),t.abrupt("return",t.t0);case 13:case"end":return t.stop()}},t,null,[[0,10]])}))},this.isEditableElement=function(t){return!!(t instanceof HTMLElement&&t.isContentEditable)||(t instanceof HTMLInputElement&&/|text|email|number|password|search|tel|url/.test(t.type||"")||t instanceof HTMLTextAreaElement)&&!(t.disabled||t.readOnly)},this.$element=document.getElementById("valet"),this.$input=document.getElementById("valet--input"),this.$close=document.getElementById("valet--close"),this.bind(),this.build()}return _createClass(t,[{key:"bind",value:function(){var e=this;document.addEventListener("keydown",function(t){e.keysPressed[t.key]=!0,e.keysPressed.Shift&&e.keysPressed[" "]&&(e.isEditableElement(document.activeElement)||(t.preventDefault(),e.open())),!0===e.isOpen&&e.keysPressed.Escape&&(t.preventDefault(),e.close())}),document.addEventListener("keyup",function(t){delete e.keysPressed[t.key]}),this.$element.addEventListener("click",function(t){t.preventDefault(),t.target===e.$element&&e.close()}),this.$close.addEventListener("click",function(t){t.preventDefault(),e.close()})}},{key:"build",value:function(){this.autoCompleteJS=new autoComplete({selector:"#valet--input",data:{src:this.getData,cache:!0,filter:function(t){return t.filter(function(e,t,n){return n.findIndex(function(t){return t.value.url===e.value.url})===t})},keys:["label","tags"]},threshold:1,debounce:50,resultsList:{element:function(t,e){var n=document.createElement("p");n.classList.add("overview"),0<e.results.length?n.innerHTML="Displaying <strong>".concat(e.results.length,"</strong> out of <strong>").concat(e.matches.length,"</strong> results"):n.innerHTML="Found <strong>".concat(e.matches.length,'</strong> matching results for <strong>"').concat(e.query,'"</strong>'),t.append(n)},noResults:!0,maxResults:6,tabSelect:!0},resultItem:{element:function(t,e){"autoComplete_result_0"===t.id&&t.setAttribute("aria-selected",!0),t.innerHTML='\n            <span class="title">\n              <span class="icon '.concat(e.value.icon,'"></span>\n              ').concat(e.value.label,'\n            </span>\n            <span class="description">\n              ').concat(e.value.description,'\n            </span>\n            <span class="url">\n              ').concat(e.value.url.split("?")[0],"\n            </span>")},highlight:!0}}),this.autoCompleteJS.input.addEventListener("results",this.onResults),this.autoCompleteJS.input.addEventListener("selection",this.onSelection)}},{key:"go",value:function(t){t=t.replace("RETURN_URL",window.location.pathname.substring(1)),this.keysPressed.Meta?(this.close(),window.open(t)):(this.$input.setAttribute("placeholder","Please wait..."),this.$input.value="",this.$input.disabled=!0,window.location=t)}},{key:"open",value:function(){var t=this;this.keysPressed={},this.isOpen=!0,this.$element.classList.add("valet--active"),this.$input.value="",setTimeout(function(){t.$input.focus()},300)}},{key:"close",value:function(){this.isOpen=!1,this.$element.classList.remove("valet--active")}}]),t}());

;
