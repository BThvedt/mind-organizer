<?php

namespace Drupal\valet;

use Drupal\Component\Plugin\Discovery\CachedDiscoveryInterface;
use Drupal\Component\Plugin\PluginManagerInterface;
use Drupal\Core\Cache\CacheableDependencyInterface;

/**
 * Defines an interface for eXo Valet Resource managers.
 */
interface ValetResourceManagerInterface extends PluginManagerInterface, CachedDiscoveryInterface, CacheableDependencyInterface {

  /**
   * Get instances.
   *
   * @return \Drupal\valet\Plugin\ValetResourceInterface[]
   *   An array of Valet Resource instances.
   */
  public function getInstances();

  /**
   * Get enabled instances.
   *
   * @return \Drupal\valet\Plugin\ValetResourceInterface[]
   *   An array of Valet Resource instances.
   */
  public function getEnabledInstances();

}
