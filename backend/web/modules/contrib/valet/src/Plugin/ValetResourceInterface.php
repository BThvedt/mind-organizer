<?php

namespace Drupal\valet\Plugin;

use Drupal\Component\Plugin\PluginInspectionInterface;
use Drupal\Core\Cache\CacheableDependencyInterface;
use Drupal\Core\Plugin\PluginFormInterface;

/**
 * Defines an interface for Valet Resource plugins.
 */
interface ValetResourceInterface extends PluginInspectionInterface, PluginFormInterface, CacheableDependencyInterface {

  /**
   * Get plugin results.
   *
   * @return \Drupal\valet\Plugin\ValetItem[]
   *   An array of items.
   */
  public function getResults();

  /**
   * Gets this plugin's default configuration.
   *
   * @return array
   *   An array of this plugin's configuration.
   */
  public function getDefaultConfiguration();

  /**
   * Returns the values.
   *
   * @return array
   *   An associative array of values.
   */
  public function &getConfiguration();

  /**
   * Returns the value for a specific key.
   *
   * @param string|array $key
   *   Configuration is stored as a multi-dimensional associative array. If $key
   *   is a string, it will use unset($values[$key]). If $key is an array, each
   *   of the array will be used as a nested key. If $key = array('foo', 'bar')
   *   it will return $values['foo']['bar'].
   * @param mixed $default
   *   (optional) The default value if the specified key does not exist.
   *
   * @return mixed
   *   The value for the given key, or NULL.
   */
  public function &getConfigurationValue($key, $default = NULL);

  /**
   * Sets the values.
   *
   * @param array $values
   *   The multi-dimensional associative array of values.
   *
   * @return $this
   */
  public function setConfiguration(array $values);

  /**
   * Sets the value for a specific key.
   *
   * @param string|array $key
   *   Configuration is stored as a multi-dimensional associative array. If $key
   *   is a string, it will use unset($values[$key]). If $key is an array, each
   *   element of the array will be used as a nested key. If
   *   $key = array('foo', 'bar') it will use $values['foo']['bar'] = $value.
   * @param mixed $value
   *   The value to set.
   *
   * @return $this
   */
  public function setConfigurationValue($key, $value);

  /**
   * Removes a specific key from the values.
   *
   * @param string|array $key
   *   Configuration is stored as a multi-dimensional associative array. If $key
   *   is a string, it will use unset($values[$key]). If $key is an array, each
   *   element of the array will be used as a nested key. If
   *   $key = array('foo', 'bar') it will use unset($values['foo']['bar']).
   *
   * @return $this
   */
  public function unsetConfigurationValue($key);

  /**
   * Determines if a specific key is present in the values.
   *
   * @param string|array $key
   *   Configuration is stored as a multi-dimensional associative array. If $key
   *   is a string, it will use unset($values[$key]). If $key is an array, each
   *   element of the array will be used as a nested key. If
   *   $key = array('foo', 'bar') it will return isset($values['foo']['bar']).
   *
   * @return bool
   *   TRUE if the $key is set, FALSE otherwise.
   */
  public function hasConfigurationValue($key);

  /**
   * Determines if a specific key has a value in the values.
   *
   * @param string|array $key
   *   Configuration is stored as a multi-dimensional associative array. If $key
   *   is a string, it will use unset($values[$key]). If $key is an array, each
   *   element of the array will be used as a nested key. If
   *   $key = array('foo', 'bar') it will return empty($values['foo']['bar']).
   *
   * @return bool
   *   TRUE if the $key has no value, FALSE otherwise.
   */
  public function isConfigurationValueEmpty($key);

}
