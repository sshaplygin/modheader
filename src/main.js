const SPECIAL_CHARS = '^$&+?.()|{}[]/'.split('');
const browser = chrome;
const modHeader = angular.module('modheader-popup', ['ngMaterial']);

modHeader.config(['$compileProvider', function ($compileProvider) {
  $compileProvider.debugInfoEnabled(true);
}]);

function fixProfile(profile) {
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

modHeader.factory('dataSource', function ($mdToast) {
  var dataSource = {};

  var isExistingProfileTitle_ = function (title) {
    for (var i = 0; i < dataSource.profiles.length; ++i) {
      if (dataSource.profiles[i].title == title) {
        return true;
      }
    }
    return false;
  };

  dataSource.addFilter = function (filters) {
    let urlRegex = '';
    if (browser.storage.currentTabUrl) {
      const parser = document.createElement('a');
      parser.href = browser.storage.currentTabUrl;
      urlRegex = parser.origin + '/.*';
    }
    filters.push({
      enabled: true,
      type: 'urls',
      urlRegex: urlRegex
    });
  };

  dataSource.addHeader = function (headers) {
    headers.push({
      enabled: true,
      name: '',
      value: '',
      comment: ''
    });
  };

  dataSource.removeFilter = function (filters, filter) {
    filters.splice(filters.indexOf(filter), 1);
  };

  dataSource.removeHeader = function (headers, header) {
    headers.splice(headers.indexOf(header), 1);
  };

  dataSource.removeHeaderEnsureNonEmpty = function (headers, header) {
    dataSource.removeHeader(headers, header);
    if (!headers.length) {
      dataSource.addHeader(headers);
    }
  };

  dataSource.pause = function () {
    dataSource.isPaused = true;
    browser.storage.isPaused = true;
    $mdToast.show(
      $mdToast.simple()
        .content('ModHeader paused')
        .position('bottom')
        .hideDelay(1000)
    );
  };

  dataSource.play = function () {
    dataSource.isPaused = false;
    browser.storage.removeItem('isPaused');
    $mdToast.show(
      $mdToast.simple()
        .content('ModHeader unpaused')
        .position('bottom')
        .hideDelay(1000)
    );
  };

  dataSource.lockToTab = function () {
    dataSource.lockedTabId = browser.storage.activeTabId;
    browser.storage.lockedTabId = dataSource.lockedTabId;
    $mdToast.show(
      $mdToast.simple()
        .content('Restricted ModHeader to the current tab')
        .position('bottom')
        .hideDelay(1000)
    );
  };

  dataSource.unlockAllTab = function () {
    dataSource.lockedTabId = null;
    browser.storage.removeItem('lockedTabId');
    $mdToast.show(
      $mdToast.simple()
        .content('Applying ModHeader to all tabs')
        .position('bottom')
        .hideDelay(1000)
    );
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

    const profile = {
      title: 'Profile ' + index,
      hideComment: true,
      headers: [],
      respHeaders: [],
      filters: [],
      appendMode: ''
    };

    dataSource.addHeader(profile.headers);

    return profile;
  };

  dataSource.save = function () {
    browser.storage.profiles = angular.toJson(dataSource.profiles);
    browser.storage.selectedProfileIdx = dataSource.profiles.indexOf(dataSource.selectedProfile);
  };

  dataSource.predicate = '';
  dataSource.reverse = false;

  if (browser.storage.profiles) {
    dataSource.profiles = angular.fromJson(browser.storage.profiles);
    for (let profile of dataSource.profiles) {
      fixProfile(profile);
    }
  } else {
    dataSource.profiles = [];
  }

  if (dataSource.profiles.length == 0) {
    dataSource.profiles.push(dataSource.createProfile());
  }

  angular.forEach(dataSource.profiles, function (profile, index) {
    if (!profile.title) {
      profile.title = 'Profile ' + (index + 1);
    }
    if (!profile.headers) {
      profile.headers = [];
      dataSource.addHeader(profile.headers);
    }
    if (!profile.respHeaders) {
      profile.respHeaders = [];
      dataSource.addHeader(profile.respHeaders);
    }
    if (!profile.filters) {
      profile.filters = [];
    }
    if (!profile.appendMode) {
      profile.appendMode = '';
    }
  });

  if (browser.storage.selectedProfileIdx) {
    dataSource.selectedProfile = dataSource.profiles[Number(browser.storage.selectedProfileIdx)];
  }
  if (!dataSource.selectedProfile) {
    dataSource.selectedProfile = dataSource.profiles[0];
  }
  if (browser.storage.isPaused) {
    dataSource.isPaused = browser.storage.isPaused;
  }
  if (browser.storage.lockedTabId) {
    dataSource.lockedTabId = browser.storage.lockedTabId;
  }

  return dataSource;
});

modHeader.factory('profileService', function ($timeout, $mdSidenav, $mdUtil, $mdDialog, $mdToast, dataSource) {
  var profileService = {};

  var closeOptionsPanel_ = function () {
    $mdSidenav('left').close();
  };

  var updateSelectedProfile_ = function () {
    $timeout(function () {
      dataSource.selectedProfile = dataSource.profiles[dataSource.profiles.length - 1];
    }, 1);
  };

  profileService.selectProfile = function (profile) {
    dataSource.selectedProfile = profile;
    closeOptionsPanel_();
  };

  profileService.addProfile = function () {
    dataSource.profiles.push(dataSource.createProfile());
    updateSelectedProfile_();
    closeOptionsPanel_();

    dataSource.save();
  };

  profileService.cloneProfile = function (profile) {
    var newProfile = angular.copy(profile);
    newProfile.title = 'Copy of ' + newProfile.title;
    dataSource.profiles.push(newProfile);
    updateSelectedProfile_();
  };

  profileService.deleteProfile = function (profile) {
    dataSource.profiles.splice(dataSource.profiles.indexOf(profile), 1);
    if (dataSource.profiles.length == 0) {
      profileService.addProfile();
    } else {
      updateSelectedProfile_();
    }
  };

  profileService.exportProfile = function (event, profile) {
    var parentEl = angular.element(document.body);
    $mdDialog.show({
      parent: parentEl,
      targetEvent: event,
      focusOnOpen: false,
      templateUrl: 'exportdialog.tmpl.html',
      locals: {
        title: profile.title,
        profile: angular.toJson(profile)
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

      $scope.closeDialog = function () {
        $mdDialog.hide();
      };
    }
  };

  profileService.importProfile = function (event, profile) {
    var parentEl = angular.element(document.body);
    $mdDialog.show({
      parent: parentEl,
      targetEvent: event,
      focusOnOpen: false,
      templateUrl: 'importdialog.tmpl.html',
      locals: {
        profile: profile
      },
      controller: DialogController_
    }).then(function (importProfile) {
      try {
        angular.copy(angular.fromJson(importProfile), profile);
        fixProfile(profile);
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
    });
    function DialogController_($scope, $mdDialog, profile) {
      $scope.importProfile = '';

      $scope.closeDialog = function () {
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
      templateUrl: 'settings.tmpl.html',
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

  // todo: deadcode
  profileService.openCloudBackup = (event) => {
    const parentEl = angular.element(document.body);
    $mdDialog.show({
      parent: parentEl,
      targetEvent: event,
      focusOnOpen: false,
      templateUrl: 'cloudbackupdialog.tmpl.html',
      controller: DialogController_
    }).then((profiles) => {
      if (!profiles) {
        return;
      }
      try {
        dataSource.profiles = profiles;
        dataSource.selectedProfile = dataSource.profiles[0];
        dataSource.save();

        $mdToast.show(
          $mdToast.simple()
            .content('Profiles successfully import')
            .position('top')
            .hideDelay(1000)
        );
      } catch (e) {
        $mdToast.show(
          $mdToast.simple()
            .content('Failed to import profiles')
            .position('top')
            .hideDelay(1000)
        );
      }
    });

    function DialogController_($scope, $mdDialog) {
      browser.storage.sync.get(null, (items) => {
        let savedData = [];
        if (!items) {
          items = [];
        }
        for (const key in items) {
          try {
            const serializedProfiles = items[key];
            const profiles = angular.fromJson(serializedProfiles);
            for (let profile of profiles) {
              fixProfile(profile);
            }
            savedData.push({
              'timeInMs': key,
              'profiles': profiles,
            });
          } catch (e) {
            // skip invalid profile.
          }
        }
        $scope.savedData = savedData;
      });

      $scope.selectProfiles = function (profiles) {
        $mdDialog.hide(profiles);
      };

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
    profile.headers = orderBy(
      profile.headers, dataSource.predicate, dataSource.reverse);
    profile.respHeaders = orderBy(
      profile.respHeaders, dataSource.predicate, dataSource.reverse);
  };
});

modHeader.controller('AppController', function (
  $scope, $mdSidenav, $mdUtil, $window, $mdToast,
  dataSource, profileService, autocompleteService
) {

  console.log('create');

  $scope.toggleSidenav = $mdUtil.debounce(function () {
    $mdSidenav('left').toggle();
  }, 300);

  // $window.onunload = function (e) {
  //   dataSource.save();
  // };

  $window.$destroy = (e) => {
    console.log('destroy', e);

    dataSource.save();
  };

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
    templateUrl: 'footer.tmpl.html'
  });
});

modHeader.controller('ToastCtrl', function ($mdToast, $mdDialog, $document, $scope) {
  let ctrl = this;

  ctrl.goToUrl = function (url) {
    browser.tabs.create({ url: url });
  };
});
