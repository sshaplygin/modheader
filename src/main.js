const SPECIAL_CHARS = '^$&+?.()|{}[]/'.split('');
const browser = chrome;
const modHeader = angular.module('modheader-popup', ['ngMaterial']);

modHeader.config(['$compileProvider', ($compileProvider) => {
  $compileProvider.debugInfoEnabled(true);
}]);

// modHeader.config(['$provide', function ($provide) {
//   $provide.decorator('$q', ['$delegate', '$exceptionHandler', function ($delegate, $exceptionHandler) {
//     var $q = $delegate;

//     $q.defer = function () {
//       var deferred = $delegate.defer();

//       deferred.promise.catch(function (reason) {
//         $exceptionHandler(reason);
//       });

//       return deferred;
//     };

//     return $q;
//   }]);
// }]);

// modHeader.factory('$exceptionHandler', function () {
//   return function (exception, cause) {
//     console.error('Exception:', exception, 'Cause:', cause);
//   };
// });


// modHeader.config(function ($provide) {
//   $provide.decorator('$q', function ($delegate, $exceptionHandler) {
//     var $q = $delegate;

//     // Переопределяем метод defer, чтобы добавить обработку ошибок
//     $q.defer = function () {
//       var deferred = $delegate.defer();

//       deferred.promise.catch(function (reason) {
//         // Обработка отклонения промиса
//         $exceptionHandler(reason);
//       });

//       return deferred;
//     };

//     return $q;
//   });
// });

// modHeader.factory('$exceptionHandler', function () {
//   return function (exception, cause) {
//     console.error('Ошибка:', exception, 'Причина:', cause);
//     // Дополнительная логика для обработки ошибок
//   };
// });

function fixProfileFilters(profile) {
  if (!profile.filters) {
    return;
  }

  for (let filter of profile.filters) {
    if (filter.urlPattern) {
      const urlPattern = filter.urlPattern;
      const joiner = [];
      for (let i = 0; i < urlPattern.length; ++i) {
        let c = urlPattern.charAt(i);
        if (SPECIAL_CHARS.indexOf(c) >= 0) {
          c = '\\' + c;
        } else if (c == '\\') {
          c = '\\\\';
        } else if (c == '*') {
          c = '.*';
        }
        joiner.push(c);
      }
      delete filter.urlPattern;
      filter.urlRegex = joiner.join('');
    }
  }
}

function setDefaultProfileField(idx, profile, titlePrefix = 'Profile ') {
  if (!profile) {
    return;
  }

  if (!profile.title) {
    profile.title = titlePrefix + (idx + 1);
  }

  if (!profile.reqHeaders) {
    profile.reqHeaders = [
      {
        enabled: true,
        name: '',
        value: '',
        comment: ''
      }
    ];
  }

  if (!profile.respHeaders) {
    profile.respHeaders = [];
  }

  if (!profile.filters) {
    profile.filters = [];
  }

  if (!profile.appendMode) {
    profile.appendMode = false;
  }

  if (!profile.createdAt) {
    profile.createdAt = Date.now();
  }
}

modHeader.factory('dataSource', function ($mdToast) {
  let dataSource = {
    predicate: '',
    reverse: false,
    isPaused: false,
    lockedTabId: -1,
    profiles: [],
    selectedProfileIdx: -1,
  };

  browser.storage.local.get(['profiles'], (res) => {
    let { profiles } = res;

    console.log('load profiles', profiles);

    if (!profiles || profiles.length === 0) {
      dataSource.profiles.push(dataSource.createProfile());
      dataSource.selectedProfileIdx = 0;

      return;
    }

    dataSource.profiles = profiles;

    for (let profile of dataSource.profiles) {
      fixProfileFilters(profile);
    }

    dataSource.profiles.forEach((profile, idx) => {
      setDefaultProfileField(idx, profile)
    });
  });

  browser.storage.local.get(['selectedProfileIdx'], (res) => {
    let { selectedProfileIdx } = res;
    if (selectedProfileIdx === undefined) {
      return;
    }

    dataSource.selectedProfileIdx = selectedProfileIdx;
  });

  browser.storage.local.get(['isPaused'], (res) => {
    let { isPaused } = res;
    if (isPaused === undefined) {
      return;
    }

    dataSource.isPaused = isPaused;
  });

  browser.storage.local.get(['lockedTabId'], (res) => {
    let { lockedTabId } = res;
    if (lockedTabId === undefined) {
      return;
    }

    dataSource.lockedTabId = lockedTabId;
  });

  var isExistingProfileTitle_ = function (title) {
    for (var i = 0; i < dataSource.profiles.length; ++i) {
      if (dataSource.profiles[i].title == title) {
        return true;
      }
    }
    return false;
  };

  dataSource.addFilter = function (filters) {
    browser.storage.local.get(['currentTabUrl'], (res) => {
      let { currentTabUrl } = res;

      console.log('currentTabUrl', currentTabUrl);

      if (!currentTabUrl) {
        return;
      }

      const parser = document.createElement('a');
      parser.href = currentTabUrl;
      let urlRegex = parser.origin + '/.*';

      filters.push({
        enabled: true,
        type: 'urls',
        urlRegex: urlRegex
      });
    });
  };

  dataSource.addHeader = function (headers) {
    headers.push({
      enabled: true,
      name: '',
      value: '',
      comment: ''
    });

    dataSource.updateLocalProfiles();
  };

  dataSource.removeFilter = function (filters, filter) {
    filters.splice(filters.indexOf(filter), 1);

    dataSource.updateLocalProfiles();
  };

  dataSource.removeHeader = function (headers, header) {
    headers.splice(headers.indexOf(header), 1);

    dataSource.updateLocalProfiles();
  };

  dataSource.removeHeaderEnsureNonEmpty = function (headers, header) {
    dataSource.removeHeader(headers, header);
    if (!headers.length) {
      dataSource.addHeader(headers);
    }

    dataSource.updateLocalProfiles();
  };

  dataSource.pause = () => {
    dataSource.isPaused = true;
    browser.storage.local.set({ 'isPaused': true });

    $mdToast.show(
      $mdToast.simple()
        .content('ModHeader paused')
        .position('bottom')
        .hideDelay(1000)
    );
  };

  dataSource.play = function () {
    dataSource.isPaused = false;
    browser.storage.local.set({ 'isPaused': false });

    $mdToast.show(
      $mdToast.simple()
        .content('ModHeader unpaused')
        .position('bottom')
        .hideDelay(1000)
    );
  };

  // todo: update selectedProfile
  dataSource.onBlurInput = (val) => {
    console.log(dataSource.profiles[dataSource.selectedProfileIdx].title);
  };

  dataSource.hasDuplicateHeaderName = function (headers, name) {
    for (var i = 0; i < headers.length; ++i) {
      var header = headers[i];
      if (header.enabled && header.name == name) {
        return true;
      }
    }
    return false;
  };

  dataSource.createProfile = function () {
    let index = 1;

    while (isExistingProfileTitle_('Profile ' + index)) {
      index++;
    }

    return {
      title: 'Profile ' + index,
      hideComment: true,
      reqHeaders: [
        {
          enabled: true,
          name: '',
          value: '',
          comment: ''
        }
      ],
      respHeaders: [],
      filters: [],
      appendMode: false,
      createdAt: Date.now(),
    };
  };

  dataSource.updateLocalProfiles = () => {
    browser.storage.local.set({ 'profiles': dataSource.profiles });
    browser.storage.local.set({ 'selectedProfileIdx': dataSource.selectedProfileIdx });
    browser.storage.local.set({ 'selectedProfile': dataSource.profiles[dataSource.selectedProfileIdx] });
  };

  dataSource.updateSelectedProfile = () => {
    browser.storage.local.set({ 'selectedProfile': dataSource.profiles[dataSource.selectedProfileIdx] });
  };

  return dataSource;
});

modHeader.factory('profileService', function ($timeout, $mdSidenav, $mdUtil, $mdDialog, $mdToast, dataSource) {
  let profileService = {};

  var closeOptionsPanel_ = function () {
    $mdSidenav('left').close();
  };

  profileService.selectProfile = function (idx) {
    dataSource.selectedProfileIdx = idx;
    browser.storage.local.set({ 'selectedProfileIdx': dataSource.selectedProfileIdx });

    dataSource.updateSelectedProfile();
    closeOptionsPanel_();
  };

  profileService.createProfile = function () {
    dataSource.profiles.push(dataSource.createProfile());
    dataSource.selectedProfileIdx = dataSource.profiles.length - 1;

    closeOptionsPanel_();

    dataSource.updateLocalProfiles();
  };

  profileService.pushProfile = function (profile) {
    dataSource.profiles.push(profile);
    dataSource.selectedProfileIdx = dataSource.profiles.length - 1;

    closeOptionsPanel_();

    dataSource.updateLocalProfiles();
  };

  profileService.cloneProfile = function (idx) {
    let newProfile = JSON.parse(JSON.stringify(dataSource.profiles[idx]));
    newProfile.title = 'Copy of ' + newProfile.title;
    // todo: remove $$hashKey
    delete newProfile['$$hashKey'];

    console.log('newProfile', newProfile);

    dataSource.profiles.push(newProfile);
    dataSource.selectedProfileIdx = dataSource.profiles.length - 1;

    dataSource.updateLocalProfiles();
  };

  profileService.deleteProfile = function (idx) {
    let newIdx = 0;
    if (idx == dataSource.profiles.length - 1 && dataSource.profiles.length != 1) {
      newIdx = idx - 1;
    } else {
      newIdx = idx;
    }

    dataSource.profiles.splice(idx, 1);
    if (dataSource.profiles.length == 0) {
      profileService.createProfile();
    }

    dataSource.selectedProfileIdx = newIdx;
    dataSource.updateLocalProfiles();
  };

  profileService.exportProfile = function (event, profile) {
    $mdDialog.show({
      parent: angular.element(document.body),
      targetEvent: event,
      focusOnOpen: false,
      templateUrl: 'dialogs/exportdialog.tmpl.html',
      locals: {
        title: profile.title,
        profile: profile,
      },
      controller: DialogController_
    });

    function DialogController_($scope, $mdDialog, $mdToast, title, profile) {
      $scope.title = title;
      $scope.profile = profile;

      $scope.copy = function () {
        document.getElementById('exportedProfile').select();
        document.execCommand('copy');
        $mdToast.show(
          $mdToast.simple()
            .content('Copied to clipboard!')
            .position('top')
            .hideDelay(1000)
        );
      };

      $scope.closeDialog = () => {
        $mdDialog.hide();
      };
    }
  };

  // todo: fixme
  profileService.importProfile = function (event) {
    $mdDialog.show({
      parent: angular.element(document.body),
      targetEvent: event,
      focusOnOpen: false,
      templateUrl: 'dialogs/importdialog.tmpl.html',
      locals: {
        importProfile: null,
      },
      controller: DialogController_
    }).then(function (importProfile) {
      try {
        console.log('profile', importProfile, typeof (importProfile));

        importProfile = angular.fromJson(importProfile);
        setDefaultProfileField(dataSource.profiles.length, importProfile, 'Import Profile ');
        fixProfileFilters(importProfile);

        let title = importProfile.title;
        let idx = dataSource.profiles.length;
        while (dataSource.profiles.some((profile) => profile.title == title)) {
          idx++;
          title = `Import Profile ${title} ${idx}`;
        };

        importProfile.title = title;
        profileService.pushProfile(importProfile);

        $mdToast.show(
          $mdToast.simple()
            .content('Profile successfully import')
            .position('top')
            .hideDelay(1000)
        );
      } catch (e) {
        $mdToast.show(
          $mdToast.simple()
            .content('Failed to import profile')
            .position('top')
            .hideDelay(1000)
        );
      }
    }).catch((err) => { console.error(err) });

    function DialogController_($scope, $mdDialog) {
      $scope.closeDialog = () => {
        $mdDialog.hide($scope.importProfile);
      };
    }
  };

  profileService.openSettings = function (event, profile) {
    var parentEl = angular.element(document.body);
    $mdDialog.show({
      parent: parentEl,
      targetEvent: event,
      focusOnOpen: false,
      templateUrl: 'dialogs/settings.tmpl.html',
      locals: {
        profile: profile
      },
      controller: DialogController_
    });

    function DialogController_($scope, $mdDialog, profile) {
      $scope.profile = profile;

      $scope.closeDialog = function () {
        $mdDialog.hide();
      };
    }
  };

  return profileService;
});

modHeader.factory('autocompleteService', function (dataSource) {
  var autocompleteService = {};

  autocompleteService.requestHeaderNames = [
    'Authorization',
    'Cache-Control',
    'Connection',
    'Content-Length',
    'Host',
    'If-Modified-Since',
    'If-None-Match',
    'If-Range',
    'Partial-Data',
    'Pragma',
    'Proxy-Authorization',
    'Proxy-Connection',
    'Transfer-Encoding',
    'Accept',
    'Accept-Charset',
    'Accept-Encoding',
    'Accept-Language',
    'Accept-Datetime',
    'Cookie',
    'Content-MD5',
    'Content-Type',
    'Date',
    'Expect',
    'From',
    'If-Match',
    'If-Unmodified-Since',
    'Max-Forwards',
    'Origin',
    'Range',
    'Referer',
    'TE',
    'User-Agent',
    'Upgrade',
    'Via',
    'Warning',
    'X-Forwarded-For',
    'X-Forwarded-Host',
    'X-Forwarded-Proto',
    'Front-End-Https',
    'X-Http-Method-Override',
    'X-ATT-DeviceId',
    'X-Wap-Profile',
    'X-UIDH',
    'X-Csrf-Token'];
  autocompleteService.requestHeaderValues = [];

  autocompleteService.responseHeaderNames = [
    'Access-Control-Allow-Origin',
    'Accept-Patch',
    'Accept-Ranges',
    'Age',
    'Allow',
    'Connection',
    'Content-Disposition',
    'Content-Encoding',
    'Content-Language',
    'Content-Length',
    'Content-Location',
    'Content-MD5',
    'Content-Range',
    'Content-Type',
    'Date',
    'ETag',
    'Expires',
    'Last-Modified',
    'Link',
    'Location',
    'P3P',
    'Pragma',
    'Proxy-Authenticate',
    'Public-Key-Pins',
    'Refresh',
    'Retry-After',
    'Server',
    'Set-Cookie',
    'Strict-Transport-Security',
    'Trailer',
    'Transfer-Encoding',
    'Upgrade',
    'Vary',
    'Via',
    'Warning',
    'WWW-Authenticate',
    'X-Frame-Options',
    'X-XSS-Protection',
    'Content-Security-Policy',
    'X-Content-Type-Options',
    'X-Powered-By',
    'X-UA-Compatible',
    'X-Content-Duration',
    'X-Content-Security-Policy',
    'X-WebKit-CSP',
  ];
  autocompleteService.responseHeaderValues = [];

  function createFilterFor_(query) {
    var lowercaseQuery = query.toLowerCase();
    return function filterFn(item) {
      return (item.toLowerCase().indexOf(lowercaseQuery) == 0);
    };
  }

  autocompleteService.query = function (cache, sourceHeaderList, field, query) {
    if (!query || query.length < 2) {
      return [];
    }
    angular.forEach(sourceHeaderList, function (header) {
      if (header[field] != query && cache.indexOf(header[field]) < 0) {
        cache.push(header[field]);
      }
    });
    return cache.filter(createFilterFor_(query));
  };
  return autocompleteService;
});

modHeader.controller('SortingController', function ($filter, dataSource) {
  this.order = function (profile, predicate) {
    dataSource.reverse = (dataSource.predicate === predicate)
      ? !dataSource.reverse : false;
    dataSource.predicate = predicate;

    var orderBy = $filter('orderBy');
    profile.reqHeaders = orderBy(
      profile.reqHeaders, dataSource.predicate, dataSource.reverse);
    profile.respHeaders = orderBy(
      profile.respHeaders, dataSource.predicate, dataSource.reverse);
  };
});

modHeader.controller('AppController', function (
  $scope, $mdSidenav, $mdUtil, $mdToast,
  dataSource, profileService, autocompleteService
) {
  console.log('create');

  $scope.toggleSidenav = $mdUtil.debounce(() => {
    $mdSidenav('left').toggle();
  }, 300);

  $scope.openLink = function (link) {
    browser.tabs.create({ url: link });
  };

  $scope.autocompleteService = autocompleteService;
  $scope.dataSource = dataSource;
  $scope.profileService = profileService;

  const tips = [
    { text: 'Tip: You can switch between multiple profile' },
    { text: 'Tip: You can export your profile to share with others' },
    { text: 'Tip: Tab lock will apply the modification only to locked tab' },
    { text: 'Tip: Add filter will let you use regex to limit modification' },
    { text: 'Tip: Use the checkbox to quickly toggle header modification' },
    { text: 'Tip: Click on the column name to sort' },
    { text: 'Tip: Add filter also allows you to filter by resource type' },
    { text: 'Tip: Go to profile setting to toggle comment column' },
    { text: 'Tip: Append header value to existing one in profile setting' },
    { text: 'Tip: Pause button will temporarily pause all modifications' },
    { text: 'Tip: Go to cloud backup to retrieve your auto-synced profile' },
  ];

  const tip = tips[Math.floor(Math.random() * tips.length)];
  if (Math.random() * 100 >= 10) {
    return;
  }

  $mdToast.show({
    position: 'bottom',
    controller: 'ToastCtrl',
    controllerAs: 'ctrl',
    bindToController: true,
    locals: { toastMessage: tip.text, buttonText: tip.buttonText, url: tip.url },
    templateUrl: 'dialogs/footer.tmpl.html'
  });
});

modHeader.controller('ToastCtrl', function ($mdToast, $mdDialog, $document, $scope) {
  let ctrl = this;

  ctrl.goToUrl = function (url) {
    browser.tabs.create({ url: url });
  };
});
