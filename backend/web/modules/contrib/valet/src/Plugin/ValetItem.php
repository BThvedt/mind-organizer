<?php

namespace Drupal\valet\Plugin;

use Drupal\Component\Utility\NestedArray;

/**
 * Base class for Valet Resource plugins.
 */
class ValetItem implements \IteratorAggregate, \ArrayAccess, \Countable {

  /**
   * The array.
   *
   * @var array
   */
  protected $data;

  /**
   * The default properties.
   *
   * @var array
   */
  protected $defaults = [
    'label' => '',
    'description' => '',
    'url' => '',
    'icon' => '',
    'tags' => [],
  ];

  /**
   * Array object constructor.
   *
   * @param array $data
   *   An array.
   */
  public function __construct(array $data = []) {
    $data = array_intersect_key($data, $this->defaults) + $this->defaults;
    $this->data = $data;
  }

  /**
   * Returns whether the requested key exists.
   *
   * @param mixed $property
   *   A key.
   *
   * @return bool
   *   TRUE or FALSE
   */
  public function __isset($property) {
    return $this->offsetExists($property);
  }

  /**
   * Sets the value at the specified key to value.
   *
   * @param mixed $property
   *   A key.
   * @param mixed $value
   *   A value.
   */
  public function __set($property, $value) {
    $this->offsetSet($property, $value);
  }

  /**
   * Unsets the value at the specified key.
   *
   * @param mixed $property
   *   A key.
   */
  public function __unset($property) {
    $this->offsetUnset($property);
  }

  /**
   * Returns the value at the specified key by reference.
   *
   * @param mixed $property
   *   A key.
   *
   * @return mixed
   *   The stored value.
   */
  public function &__get($property) {
    $ret =& $this->offsetGet($property);
    return $ret;
  }

  /**
   * Add a tag.
   *
   * @param string $tag
   *   The tag.
   */
  public function addTag($tag) {
    $this->data['tags'][$tag] = $tag;
  }

  /**
   * Returns the data as an array.
   *
   * @return array
   *   The array.
   */
  public function toArray() {
    $this->data['tags'] = implode(', ', $this->data['tags']);
    return $this->data;
  }

  /**
   * Get the number of public properties in the ArrayObject.
   *
   * @return int
   *   The count.
   */
  public function count(): int {
    return count($this->data);
  }

  /**
   * Returns whether the requested key is empty.
   *
   * @param mixed $property
   *   A key.
   *
   * @return bool
   *   TRUE or FALSE
   */
  public function empty($property) {
    return empty($this->offsetGet($property));
  }

  /**
   * Returns whether the requested key exists.
   *
   * @param mixed $property
   *   A key.
   *
   * @return bool
   *   TRUE or FALSE
   */
  public function has($property) {
    return $this->offsetExists($property);
  }

  /**
   * Returns the value at the specified key.
   *
   * @param mixed $property
   *   A key.
   *
   * @return mixed
   *   The value.
   */
  public function &get($property) {
    return $this->offsetGet($property);
  }

  /**
   * Sets the value at the specified key to value.
   *
   * @param mixed $property
   *   A key.
   * @param mixed $value
   *   A value.
   *
   * @return $this
   */
  public function set($property, $value) {
    $this->offsetSet($property, $value);
    return $this;
  }

  /**
   * Sets the value at the specified key to value if it is not set already.
   *
   * @param mixed $property
   *   A key.
   * @param mixed $value
   *   A value.
   *
   * @return $this
   */
  public function setIfUnset($property, $value) {
    if (!$this->offsetExists($property)) {
      $this->offsetSet($property, $value);
    }
    return $this;
  }

  /**
   * Unsets the value at the specified key.
   *
   * @param mixed $property
   *   A key.
   */
  public function unset($property) {
    $this->offsetUnset($property);
  }

  /**
   * Returns whether the requested key exists.
   *
   * @param mixed $property
   *   A key.
   *
   * @return bool
   *   TRUE or FALSE
   */
  public function offsetExists($property): bool {
    $exists = NULL;
    NestedArray::getValue($this->data, (array) $property, $exists);
    return $exists;
  }

  /**
   * Returns the value at the specified key.
   *
   * @param mixed $property
   *   A key.
   *
   * @return mixed
   *   The value.
   */
  public function &offsetGet($property): mixed {
    $value = NULL;
    if (!$this->offsetExists($property)) {
      return $value;
    }
    $value = &NestedArray::getValue($this->data, (array) $property);
    return $value;
  }

  /**
   * Sets the value at the specified key to value.
   *
   * @param mixed $property
   *   A key.
   * @param mixed $value
   *   A value.
   */
  public function offsetSet($property, $value): void {
    if ($value instanceof ValetItem) {
      $value = $value->toArray();
    }
    NestedArray::setValue($this->data, (array) $property, $value, TRUE);
  }

  /**
   * Unsets the value at the specified key.
   *
   * @param mixed $offset
   *   A key.
   */
  public function offsetUnset($offset): void {
    NestedArray::unsetValue($this->data, (array) $offset);
  }

  /**
   * Returns an iterator for entities.
   *
   * @return \ArrayIterator
   *   An \ArrayIterator instance
   */
  public function getIterator(): \ArrayIterator {
    return new \ArrayIterator($this->data);
  }

}
